/**
 * WebSocket gateway — WebSocket 网关
 *
 * Manages the persistent WebSocket connection to the Bajoseek server.
 * 管理与 Bajoseek 服务端的持久化 WebSocket 连接。
 *
 * Features / 功能特性:
 *   - Auto-reconnect with exponential backoff (1s → 2s → 5s → 10s → 30s → 60s)
 *     指数退避自动重连
 *   - Per-user isolated message queues (max 20 msgs/user, 10 concurrent users)
 *     按用户隔离的消息队列（单用户上限 20 条，最多 10 用户并发处理）
 *   - Heartbeat ping every 30 seconds
 *     每 30 秒心跳 ping
 *   - Graceful shutdown via AbortSignal
 *     通过 AbortSignal 优雅关闭
 *   - Block streaming & fallback chunked delivery
 *     分块流式回复与回退分块投递
 */
import WebSocket from "ws";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedBajoseekAccount, InboundUserMessage } from "./types.js";
import { getBajoseekRuntime } from "./runtime.js";
import { sendStreamChunk, sendStreamEnd, sendChunkedEnd } from "./outbound.js";

/**
 * Fallback chunk size (chars) when block streaming is disabled.
 * 非 block streaming 模式下的回退分块大小（字符数）。
 */
const FALLBACK_CHUNK_SIZE = 10000;

/* ════════════════════════════════════════════════════════════
 *  Global connection pool / 全局连接池
 * ════════════════════════════════════════════════════════════ */

/** Map of accountId → active WebSocket. / accountId → 活跃 WebSocket 的映射。 */
const wsConnections = new Map<string, WebSocket>();

/**
 * Get the active WebSocket for an account (if any).
 * 获取某账户的活跃 WebSocket（如有）。
 */
export function getWsConnection(accountId: string): WebSocket | undefined {
  return wsConnections.get(accountId);
}

/* ════════════════════════════════════════════════════════════
 *  Gateway context / 网关上下文
 * ════════════════════════════════════════════════════════════ */

/** Parameters for starting the gateway. / 启动网关的参数。 */
export interface GatewayContext {
  /** Resolved account to connect. / 要连接的已解析账户。 */
  account: ResolvedBajoseekAccount;
  /** Signal to trigger graceful shutdown. / 触发优雅关闭的信号。 */
  abortSignal: AbortSignal;
  /** OpenClaw configuration. / OpenClaw 配置。 */
  cfg: OpenClawConfig;
  /** Callback fired when the WebSocket is ready. / WebSocket 就绪时的回调。 */
  onReady?: () => void;
  /** Callback fired on connection errors. / 连接错误时的回调。 */
  onError?: (error: Error) => void;
  /** Logger instance. / 日志实例。 */
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

/* ════════════════════════════════════════════════════════════
 *  Per-user message queue / 按用户隔离的消息队列
 * ════════════════════════════════════════════════════════════ */

/** Max queued messages per user. / 单用户最大排队消息数。 */
const PER_USER_QUEUE_SIZE = 20;

/** Max users processed concurrently. / 最大并发处理用户数。 */
const MAX_CONCURRENT_USERS = 10;

interface QueuedMessage {
  accountId: string;
  event: InboundUserMessage;
}

/* ════════════════════════════════════════════════════════════
 *  startGateway — main entry / 网关主入口
 * ════════════════════════════════════════════════════════════ */

/**
 * Start the WebSocket gateway with auto-reconnect.
 * 启动带自动重连的 WebSocket 网关。
 *
 * Runs a connect loop until the `abortSignal` fires.
 * 运行连接循环直到 `abortSignal` 触发。
 */
export async function startGateway(ctx: GatewayContext): Promise<void> {
  const { account, abortSignal, cfg, onReady, onError, log } = ctx;

  if (!account.botId || !account.token) {
    throw new Error("Bajoseek not configured (missing botId or token)");
  }

  let reconnectAttempts = 0;
  let isAborted = false;
  let currentWs: WebSocket | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // Listen for abort signal to shut down gracefully.
  // 监听 abort 信号以优雅关闭。
  abortSignal.addEventListener("abort", () => {
    isAborted = true;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    if (currentWs) {
      currentWs.close(1000, "shutdown");
      currentWs = null;
    }
    wsConnections.delete(account.accountId);
    log?.info(`[bajoseek:${account.accountId}] Gateway shut down via abort signal`);
  });

  // Per-user message queues. / 按用户的消息队列。
  const userQueues = new Map<string, QueuedMessage[]>();
  const activeUsers = new Set<string>();

  /**
   * Enqueue an inbound message into the user's queue.
   * 将收到的消息入队到对应用户的队列。
   */
  const enqueueMessage = (msg: QueuedMessage): void => {
    const peerId = `dm:${msg.event.userId}`;
    let queue = userQueues.get(peerId);
    if (!queue) {
      queue = [];
      userQueues.set(peerId, queue);
    }

    // Drop oldest if queue full. / 队列满时丢弃最旧消息。
    if (queue.length >= PER_USER_QUEUE_SIZE) {
      queue.shift();
      log?.error(`[bajoseek:${account.accountId}] Per-user queue full for ${peerId}, dropping oldest`);
    }

    queue.push(msg);
    drainUserQueue(peerId);
  };

  /**
   * Process queued messages for a specific user sequentially.
   * 按顺序处理指定用户的排队消息。
   */
  const drainUserQueue = async (peerId: string): Promise<void> => {
    if (activeUsers.has(peerId) || activeUsers.size >= MAX_CONCURRENT_USERS) {
      return;
    }

    const queue = userQueues.get(peerId);
    if (!queue || queue.length === 0) {
      userQueues.delete(peerId);
      return;
    }

    activeUsers.add(peerId);
    try {
      while (queue.length > 0 && !isAborted) {
        const msg = queue.shift()!;
        await handleInboundMessage(msg);
      }
    } finally {
      activeUsers.delete(peerId);
      // Try draining other waiting users. / 尝试排空其他等待中的用户。
      for (const [pid, q] of userQueues) {
        if (q.length > 0 && !activeUsers.has(pid)) {
          drainUserQueue(pid);
        }
      }
    }
  };

  /* ── Handle a single inbound message / 处理单条入站消息 ── */
  const handleInboundMessage = async (msg: QueuedMessage): Promise<void> => {
    const { event } = msg;
    const pluginRuntime = getBajoseekRuntime();

    log?.info(`[bajoseek:${account.accountId}] Processing message from userId=${event.userId}, text=${event.text.slice(0, 100)}`);

    // Build addressing info. / 构建地址信息。
    const fromAddress = `bajoseek:user:${event.userId}`;
    const toAddress = `bajoseek:bot:${account.botId}`;
    const sessionKey = `bajoseek:dm:${event.userId}:${account.accountId}:${event.conversationId}`;

    const body = event.text;
    const agentBody = event.text;

    // Construct the inbound context payload for the OpenClaw reply pipeline.
    // 构造 OpenClaw 回复管线的入站上下文载荷。
    const ctxPayload = pluginRuntime.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: agentBody,
      RawBody: event.text,
      CommandBody: event.text,
      CommandAuthorized: true,
      From: fromAddress,
      To: toAddress,
      SessionKey: sessionKey,
      AccountId: account.accountId,
      ChatType: "direct" as const,
      SenderId: event.userId,
      SenderName: event.userId,
      Provider: "bajoseek",
      Surface: "bajoseek",
      MessageSid: event.messageId,
      Timestamp: event.timestamp,
      OriginatingChannel: "bajoseek",
      OriginatingTo: toAddress,
    });

    try {
      const messagesConfig = pluginRuntime.channel.reply.resolveEffectiveMessagesConfig(cfg, "");

      const conversationId = event.conversationId;
      let hasResponse = false;
      let pendingText: string | null = null;
      let receivedBlocks = false;

      // Read blockStreaming config. / 读取 blockStreaming 配置。
      const blockStreamingCfg = account.config?.blockStreaming;
      const replyOptions: Record<string, unknown> = {};
      if (typeof blockStreamingCfg === "boolean") {
        replyOptions.disableBlockStreaming = !blockStreamingCfg;
      }

      // Dispatch the reply through OpenClaw's block dispatcher.
      // 通过 OpenClaw 的块分发器分发回复。
      const dispatchPromise = pluginRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        replyOptions,
        dispatcherOptions: {
          responsePrefix: messagesConfig.responsePrefix,
          /**
           * Delivery callback — called for each output block/final.
           * 投递回调——每个输出块/最终结果都会调用。
           */
          deliver: async (payload: { text?: string }, info: { kind: string }) => {
            hasResponse = true;

            const text = payload.text ?? "";
            log?.info(`[bajoseek:${account.accountId}] deliver: kind=${info.kind}, text.length=${text.length}, text.preview=${JSON.stringify(text.slice(0, 200))}`);

            // Skip tool intermediate results. / 跳过 tool 中间结果。
            if (info.kind === "tool") {
              log?.info(`[bajoseek:${account.accountId}] Skipping tool result, text.preview=${JSON.stringify(text.slice(0, 500))}`);
              return;
            }

            if (!text.trim()) return;

            const ws = wsConnections.get(account.accountId);
            if (!ws || ws.readyState !== WebSocket.OPEN) {
              log?.error(`[bajoseek:${account.accountId}] WebSocket not available for delivery`);
              return;
            }

            if (info.kind === "block") {
              // Block streaming mode: each block is an incremental chunk.
              // 分块流式模式：每个 block 是增量分块。
              receivedBlocks = true;
              if (pendingText !== null) {
                sendStreamChunk(ws, conversationId, pendingText);
              }
              pendingText = text;
              return;
            }

            // kind === "final"
            if (receivedBlocks) {
              // In block streaming mode, the final contains the complete text
              // which was already delivered via blocks — skip to avoid duplication.
              // 分块模式下 final 包含完整文本，内容已通过 blocks 送达——跳过以避免重复。
              log?.info(`[bajoseek:${account.accountId}] Block streaming active, skipping final (content already delivered via blocks)`);
              return;
            }

            // Non-block-streaming: may receive multiple finals (multi-step agent calls).
            // 非分块模式：可能收到多次 final（Agent 多步调用）。
            if (pendingText !== null) {
              sendStreamChunk(ws, conversationId, pendingText);
            }
            pendingText = text;
          },
        },
      });

      await dispatchPromise;

      // Send the final response. / 发送最终回复。
      const ws = wsConnections.get(account.accountId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (!hasResponse) {
          // No response generated — send error hint. / 未生成回复——发送错误提示。
          log?.error(`[bajoseek:${account.accountId}] No response from AI for messageId=${event.messageId}`);
          sendStreamEnd(ws, conversationId, "[系统提示] AI 未生成回复，请稍后重试");
        } else if (receivedBlocks) {
          // Block streaming: framework already chunked — send stream_end directly.
          // 分块模式：框架已分块——直接发送 stream_end。
          sendStreamEnd(ws, conversationId, pendingText ?? "");
          log?.info(`[bajoseek:${account.accountId}] Sent stream_end (block streaming) for conversationId=${conversationId}`);
        } else {
          // Non-block-streaming: split by FALLBACK_CHUNK_SIZE ourselves.
          // 非分块模式：我们自行按 FALLBACK_CHUNK_SIZE 拆分。
          sendChunkedEnd(ws, conversationId, pendingText ?? "", FALLBACK_CHUNK_SIZE);
          log?.info(`[bajoseek:${account.accountId}] Sent chunked stream_end for conversationId=${conversationId}`);
        }
      }
    } catch (err) {
      log?.error(`[bajoseek:${account.accountId}] Error processing message: ${err}`);
      // Send error hint to server. / 向服务端发送错误提示。
      try {
        const ws = wsConnections.get(account.accountId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const conversationId = event.conversationId;
          sendStreamEnd(ws, conversationId, "[系统提示] 处理消息时出错，请稍后重试");
        }
      } catch {
        // Sending error hint also failed — ignore. / 发送错误提示也失败——忽略。
      }
    }
  };

  /* ── Reconnect backoff schedule / 重连退避策略 ── */
  const BACKOFF_SCHEDULE = [1000, 2000, 5000, 10000, 30000, 60000];

  const getBackoffDelay = (): number => {
    const idx = Math.min(reconnectAttempts, BACKOFF_SCHEDULE.length - 1);
    return BACKOFF_SCHEDULE[idx];
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /* ── Connection loop / 连接循环 ── */
  const connect = async (): Promise<void> => {
    while (!isAborted) {
      try {
        await connectOnce();
      } catch (err) {
        if (isAborted) break;
        const delay = getBackoffDelay();
        reconnectAttempts++;
        log?.error(`[bajoseek:${account.accountId}] Connection failed: ${err}. Reconnecting in ${delay}ms (attempt #${reconnectAttempts})`);
        onError?.(err instanceof Error ? err : new Error(String(err)));
        await sleep(delay);
      }
    }
  };

  /**
   * Establish a single WebSocket connection.
   * 建立一次 WebSocket 连接。
   *
   * Resolves when the connection is closed normally; rejects on handshake failures.
   * 正常关闭时 resolve；握手失败时 reject。
   */
  const connectOnce = (): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      if (isAborted) {
        resolve();
        return;
      }

      const wsEndpoint = `${account.wsUrl.replace(/\/+$/, "")}/ws/bot`;
      log?.info(`[bajoseek:${account.accountId}] Connecting to ${wsEndpoint}...`);

      const ws = new WebSocket(wsEndpoint, {
        headers: {
          "X-Bot-Id": account.botId,
          "Authorization": `Bearer ${account.token}`,
        },
      });
      currentWs = ws;

      ws.on("open", () => {
        // Handshake succeeded — connection authenticated.
        // 握手成功——连接已认证。
        reconnectAttempts = 0;
        wsConnections.set(account.accountId, ws);
        log?.info(`[bajoseek:${account.accountId}] WebSocket connected and authenticated`);
        onReady?.();

        // Start heartbeat. / 启动心跳。
        heartbeatInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 30000);
      });

      ws.on("message", (data: WebSocket.RawData) => {
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data.toString());
        } catch {
          log?.error(`[bajoseek:${account.accountId}] Failed to parse message: ${data.toString().slice(0, 200)}`);
          return;
        }

        const msgType = parsed.type as string;

        // Handle pong (heartbeat response). / 处理 pong（心跳响应）。
        if (msgType === "pong") {
          return;
        }

        // Handle server error notification. / 处理服务端错误通知。
        if (msgType === "error") {
          log?.error(`[bajoseek:${account.accountId}] Server error: code=${parsed.code}, message=${parsed.message}`);
          return;
        }

        // Handle user message. / 处理用户消息。
        if (msgType === "message") {
          const event: InboundUserMessage = {
            type: "message",
            messageId: parsed.messageId as string,
            userId: parsed.userId as string,
            conversationId: parsed.conversationId as string,
            text: parsed.text as string,
            timestamp: (parsed.timestamp as number) || Date.now(),
          };

          log?.info(`[bajoseek:${account.accountId}] Received message: userId=${event.userId}, messageId=${event.messageId}`);

          enqueueMessage({
            accountId: account.accountId,
            event,
          });
          return;
        }

        log?.debug?.(`[bajoseek:${account.accountId}] Unhandled message type: ${msgType}`);
      });

      ws.on("close", (code, reason) => {
        log?.info(`[bajoseek:${account.accountId}] WebSocket closed: code=${code}, reason=${reason.toString()}`);
        wsConnections.delete(account.accountId);

        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }

        currentWs = null;

        if (!isAborted) {
          // Normal close — the loop will reconnect. / 正常关闭——循环将重连。
          resolve();
        }
      });

      ws.on("error", (err) => {
        log?.error(`[bajoseek:${account.accountId}] WebSocket error: ${err.message}`);
        // An `error` event is always followed by `close` — no reject here.
        // `error` 事件后总会触发 `close`——此处不 reject。
      });

      // Handle handshake rejection (e.g. HTTP 401). / 处理握手拒绝（如 HTTP 401）。
      ws.on("unexpected-response", (_req, res) => {
        const statusCode = res.statusCode;
        log?.error(`[bajoseek:${account.accountId}] WebSocket handshake rejected: HTTP ${statusCode}`);
        ws.close();
        if (statusCode === 401) {
          reject(new Error(`Authentication failed (HTTP 401): check botId and token`));
        } else {
          reject(new Error(`WebSocket handshake failed: HTTP ${statusCode}`));
        }
      });
    });
  };

  await connect();
}
