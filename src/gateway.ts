import WebSocket from "ws";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import type { ResolvedBajoseekAccount, InboundUserMessage } from "./types.js";
import { getBajoseekRuntime } from "./runtime.js";
import { sendStreamChunk, sendStreamEnd, sendChunkedEnd } from "./outbound.js";

/**
 * 非 block streaming 模式下，我们自行拆分的块大小（字符数）。
 * 可根据 WebSocket 服务端缓冲区大小调整，默认 4000 字符。
 */
const FALLBACK_CHUNK_SIZE = 10000;

// ============ 全局连接池 ============
const wsConnections = new Map<string, WebSocket>();

export function getWsConnection(accountId: string): WebSocket | undefined {
  return wsConnections.get(accountId);
}

// ============ Gateway 上下文 ============
export interface GatewayContext {
  account: ResolvedBajoseekAccount;
  abortSignal: AbortSignal;
  cfg: OpenClawConfig;
  onReady?: () => void;
  onError?: (error: Error) => void;
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

// ============ 消息队列 ============
const PER_USER_QUEUE_SIZE = 20;
const MAX_CONCURRENT_USERS = 10;

interface QueuedMessage {
  accountId: string;
  event: InboundUserMessage;
}

/**
 * 启动 Gateway WebSocket 连接（带自动重连）
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

  // 监听 abortSignal 优雅关闭
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

  // 消息队列（per-user 隔离）
  const userQueues = new Map<string, QueuedMessage[]>();
  const activeUsers = new Set<string>();

  const enqueueMessage = (msg: QueuedMessage): void => {
    const peerId = `dm:${msg.event.userId}`;
    let queue = userQueues.get(peerId);
    if (!queue) {
      queue = [];
      userQueues.set(peerId, queue);
    }

    if (queue.length >= PER_USER_QUEUE_SIZE) {
      queue.shift();
      log?.error(`[bajoseek:${account.accountId}] Per-user queue full for ${peerId}, dropping oldest`);
    }

    queue.push(msg);
    drainUserQueue(peerId);
  };

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
      // 尝试排空其他等待中的用户
      for (const [pid, q] of userQueues) {
        if (q.length > 0 && !activeUsers.has(pid)) {
          drainUserQueue(pid);
        }
      }
    }
  };

  // ============ 处理收到的用户消息 ============
  const handleInboundMessage = async (msg: QueuedMessage): Promise<void> => {
    const { event } = msg;
    const pluginRuntime = getBajoseekRuntime();

    log?.info(`[bajoseek:${account.accountId}] Processing message from userId=${event.userId}, text=${event.text.slice(0, 100)}`);

    const fromAddress = `bajoseek:user:${event.userId}`;
    const toAddress = `bajoseek:bot:${account.botId}`;
    const sessionKey = `bajoseek:dm:${event.userId}:${account.accountId}:${event.conversationId}`;

    // 构建 body
    const body = event.text;
    const agentBody = event.text;

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

      // 使用服务端传来的 conversationId
      const conversationId = event.conversationId;
      let hasResponse = false;
      let pendingText: string | null = null;
      let receivedBlocks = false;

      // 读取 blockStreaming 配置，传给框架
      const blockStreamingCfg = account.config?.blockStreaming;
      const replyOptions: Record<string, unknown> = {};
      if (typeof blockStreamingCfg === "boolean") {
        replyOptions.disableBlockStreaming = !blockStreamingCfg;
      }

      const dispatchPromise = pluginRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        replyOptions,
        dispatcherOptions: {
          responsePrefix: messagesConfig.responsePrefix,
          deliver: async (payload: { text?: string }, info: { kind: string }) => {
            hasResponse = true;

            const text = payload.text ?? "";
            log?.info(`[bajoseek:${account.accountId}] deliver: kind=${info.kind}, text.length=${text.length}, text.preview=${JSON.stringify(text.slice(0, 200))}`);

            // 跳过 tool 中间结果
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
              // 框架 block streaming 模式：每个 block 是增量分块
              receivedBlocks = true;
              if (pendingText !== null) {
                sendStreamChunk(ws, conversationId, pendingText);
              }
              pendingText = text;
              return;
            }

            // kind === "final"
            if (receivedBlocks) {
              // block streaming 模式下 final 包含完整文本，
              // 内容已通过 blocks 送达，忽略 final 避免重复
              log?.info(`[bajoseek:${account.accountId}] Block streaming active, skipping final (content already delivered via blocks)`);
              return;
            }

            // 非 block streaming：可能有多次 final（agent 多步调用）
            if (pendingText !== null) {
              sendStreamChunk(ws, conversationId, pendingText);
            }
            pendingText = text;
          },
        },
      });

      await dispatchPromise;

      const ws = wsConnections.get(account.accountId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (!hasResponse) {
          log?.error(`[bajoseek:${account.accountId}] No response from AI for messageId=${event.messageId}`);
          sendStreamEnd(ws, conversationId, "[系统提示] AI 未生成回复，请稍后重试");
        } else if (receivedBlocks) {
          // block streaming 模式：框架已分块，直接发 stream_end（不二次拆分）
          sendStreamEnd(ws, conversationId, pendingText ?? "");
          log?.info(`[bajoseek:${account.accountId}] Sent stream_end (block streaming) for conversationId=${conversationId}`);
        } else {
          // 非 block streaming：我们按 FALLBACK_CHUNK_SIZE 拆分
          sendChunkedEnd(ws, conversationId, pendingText ?? "", FALLBACK_CHUNK_SIZE);
          log?.info(`[bajoseek:${account.accountId}] Sent chunked stream_end for conversationId=${conversationId}`);
        }
      }
    } catch (err) {
      log?.error(`[bajoseek:${account.accountId}] Error processing message: ${err}`);
      // 发送错误提示给服务端
      try {
        const ws = wsConnections.get(account.accountId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const conversationId = event.conversationId;
          sendStreamEnd(ws, conversationId, "[系统提示] 处理消息时出错，请稍后重试");
        }
      } catch {
        // 发送错误提示也失败，忽略
      }
    }
  };

  // ============ 重连退避 ============
  const BACKOFF_SCHEDULE = [1000, 2000, 5000, 10000, 30000, 60000];

  const getBackoffDelay = (): number => {
    const idx = Math.min(reconnectAttempts, BACKOFF_SCHEDULE.length - 1);
    return BACKOFF_SCHEDULE[idx];
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // ============ 连接循环 ============
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
        // 握手认证通过（interceptor 已校验），直接视为认证成功
        reconnectAttempts = 0;
        wsConnections.set(account.accountId, ws);
        log?.info(`[bajoseek:${account.accountId}] WebSocket connected and authenticated`);
        onReady?.();

        // 启动心跳
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

        // 处理 pong
        if (msgType === "pong") {
          return;
        }

        // 处理服务端错误通知
        if (msgType === "error") {
          log?.error(`[bajoseek:${account.accountId}] Server error: code=${parsed.code}, message=${parsed.message}`);
          return;
        }

        // 处理用户消息
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
          // 正常关闭后通过循环重连
          resolve();
        }
      });

      ws.on("error", (err) => {
        log?.error(`[bajoseek:${account.accountId}] WebSocket error: ${err.message}`);
        // error 事件后会紧跟 close 事件，不需要在这里 reject
      });

      // 处理握手认证失败（HTTP 401）
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
