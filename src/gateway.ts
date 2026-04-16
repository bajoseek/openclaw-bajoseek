/**
 * WebSocket gateway
 *
 * Manages the persistent WebSocket connection to the Bajoseek server.
 *
 * Features
 *   - Auto-reconnect with exponential backoff (1s → 2s → 5s → 10s → 30s → 60s)
 *   - Per-user isolated message queues (max 20 msgs/user, 10 concurrent users)
 *   - Heartbeat ping every 30 seconds
 *   - Graceful shutdown via AbortSignal
 *   - Block streaming & fallback chunked delivery
 */
import WebSocket from "ws";
import type {OpenClawConfig} from "openclaw/plugin-sdk";
import type {InboundUserMessage, ResolvedBajoseekAccount} from "./types.js";
import {getBajoseekRuntime} from "./runtime.js";
import {sendChunkedEnd, sendStreamChunk, sendStreamEnd} from "./outbound.js";

/**
 * Fallback chunk size (chars) when block streaming is disabled.
 */
const FALLBACK_CHUNK_SIZE = 10000;

/**
 * Max inbound message text length (chars). Messages exceeding this are truncated.
 * 入站消息最大文本长度，超出部分截断。
 */
const MAX_INBOUND_TEXT_LENGTH = 100000;

/* ════════════════════════════════════════════════════════════
 *  Global connection pool
 * ════════════════════════════════════════════════════════════ */

/** Map of accountId → active WebSocket. */
const wsConnections = new Map<string, WebSocket>();

/**
 * Get the active WebSocket for an account (if any).
 */
export function getWsConnection(accountId: string): WebSocket | undefined {
  return wsConnections.get(accountId);
}

/* ════════════════════════════════════════════════════════════
 *  Gateway context
 * ════════════════════════════════════════════════════════════ */

/** Parameters for starting the gateway. /*/
export interface GatewayContext {
  /** Resolved account to connect. */
  account: ResolvedBajoseekAccount;
  /** Signal to trigger graceful shutdown. */
  abortSignal: AbortSignal;
  /** OpenClaw configuration. */
  cfg: OpenClawConfig;
  /** Callback fired when the WebSocket is ready. */
  onReady?: () => void;
  /** Callback fired on connection errors. */
  onError?: (error: Error) => void;
  /** Logger instance. */
  log?: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    debug?: (msg: string) => void;
  };
}

/* ════════════════════════════════════════════════════════════
 *  Per-user message queue
 * ════════════════════════════════════════════════════════════ */

/** Max queued messages per user. */
const PER_USER_QUEUE_SIZE = 20;

/** Max users processed concurrently. */
const MAX_CONCURRENT_USERS = 10;

interface QueuedMessage {
  accountId: string;
  event: InboundUserMessage;
}

/* ════════════════════════════════════════════════════════════
 *  startGateway — main entry
 * ════════════════════════════════════════════════════════════ */

/**
 * Start the WebSocket gateway with auto-reconnect.
 *
 * Runs a connect loop until the `abortSignal` fires.
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

  // Per-user message queues.
  const userQueues = new Map<string, QueuedMessage[]>();
  const activeUsers = new Set<string>();

  /**
   * Enqueue an inbound message into the user's queue.
   */
  const enqueueMessage = (msg: QueuedMessage): void => {
    const peerId = `dm:${msg.event.userId}`;
    let queue = userQueues.get(peerId);
    if (!queue) {
      queue = [];
      userQueues.set(peerId, queue);
    }

    // Drop oldest if queue full.
    if (queue.length >= PER_USER_QUEUE_SIZE) {
      queue.shift();
      log?.error(`[bajoseek:${account.accountId}] Per-user queue full for ${peerId}, dropping oldest`);
    }

    queue.push(msg);
    drainUserQueue(peerId);
  };

  /**
   * Process queued messages for a specific user sequentially.
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
      // Try draining other waiting users.
      for (const [pid, q] of userQueues) {
        if (q.length > 0 && !activeUsers.has(pid)) {
          drainUserQueue(pid);
        }
      }
    }
  };

  /* ── Handle a single inbound message ── */
  const handleInboundMessage = async (msg: QueuedMessage): Promise<void> => {
    const { event } = msg;
    const pluginRuntime = getBajoseekRuntime();

    log?.info(`[bajoseek:${account.accountId}] Processing message from userId=${event.userId}, length=${event.text.length}`);

    // Build addressing info.
    const fromAddress = `bajoseek:user:${event.userId}`;
    const toAddress = `bajoseek:bot:${account.botId}`;
    const sessionKey = `bajoseek:dm:${event.userId}:${account.accountId}:${event.conversationId}`;

    const body = event.text;
    const agentBody = event.text;

    // Construct the inbound context payload for the OpenClaw reply pipeline.
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

      // Read blockStreaming config.
      const blockStreamingCfg = account.config?.blockStreaming;
      const replyOptions: Record<string, unknown> = {};
      if (typeof blockStreamingCfg === "boolean") {
        replyOptions.disableBlockStreaming = !blockStreamingCfg;
      }

      // Dispatch the reply through OpenClaw's block dispatcher.
      const dispatchPromise = pluginRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
        ctx: ctxPayload,
        cfg,
        replyOptions,
        dispatcherOptions: {
          responsePrefix: messagesConfig.responsePrefix,
          /**
           * Delivery callback — called for each output block/final.
           */
          deliver: async (payload: { text?: string }, info: { kind: string }) => {
            hasResponse = true;

            const text = payload.text ?? "";
            log?.info(`[bajoseek:${account.accountId}] deliver: kind=${info.kind}, text.length=${text.length}, text.preview=${JSON.stringify(text.slice(0, 200))}`);

            // Skip tool intermediate results.
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
              // Block streaming mode: send each block immediately.
              // 流式模式：每个 block 立即发送。
              receivedBlocks = true;
              sendStreamChunk(ws, conversationId, text);
              return;
            }

            // kind === "final"
            if (receivedBlocks) {
              // Block streaming: final is empty, all text already sent via blocks — skip.
              // 流式模式下 final 不带文本，内容已通过 block 发送，跳过。
              return;
            }

            // Non-block-streaming: buffer for chunked delivery at the end.
            // 非流式模式：缓冲到最后统一分块发送。
            if (pendingText !== null) {
              sendStreamChunk(ws, conversationId, pendingText);
            }
            pendingText = text;
          },
        },
      });

      await dispatchPromise;

      // Send the final response.
      const ws = wsConnections.get(account.accountId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        if (!hasResponse) {
          // No response generated — send error hint.
          log?.error(`[bajoseek:${account.accountId}] No response from AI for messageId=${event.messageId}`);
          sendStreamEnd(ws, conversationId, "[Error] AI did not generate a reply, please try again later");
        } else if (receivedBlocks) {
          // Block streaming: all blocks sent via stream_chunk, send empty stream_end to close.
          // 流式模式：所有内容已通过 stream_chunk 发出，发空的 stream_end 关闭流。
          sendStreamEnd(ws, conversationId, "");
          log?.info(`[bajoseek:${account.accountId}] Sent stream_end (block streaming) for conversationId=${conversationId}`);
        } else {
          // Non-block-streaming: split by FALLBACK_CHUNK_SIZE ourselves.
          sendChunkedEnd(ws, conversationId, pendingText ?? "", FALLBACK_CHUNK_SIZE);
          log?.info(`[bajoseek:${account.accountId}] Sent chunked stream_end for conversationId=${conversationId}`);
        }
      }
    } catch (err) {
      log?.error(`[bajoseek:${account.accountId}] Error processing message: ${err}`);
      // Send error hint to server.
      try {
        const ws = wsConnections.get(account.accountId);
        if (ws && ws.readyState === WebSocket.OPEN) {
          const conversationId = event.conversationId;
          sendStreamEnd(ws, conversationId, "[Error] An error occurred while processing your message, please try again later");
        }
      } catch {
        // Sending error hint also failed — ignore.
      }
    } finally {
      // Reserved for future cleanup.
    }
  };

  /* ── Reconnect backoff schedule ── */
  const BACKOFF_SCHEDULE = [1000, 2000, 5000, 10000, 30000, 60000];

  const getBackoffDelay = (): number => {
    const idx = Math.min(reconnectAttempts, BACKOFF_SCHEDULE.length - 1);
    return BACKOFF_SCHEDULE[idx];
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  /* ── Connection loop ── */
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
   *
   * Resolves when the connection is closed normally; rejects on handshake failures.
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
        reconnectAttempts = 0;
        wsConnections.set(account.accountId, ws);
        log?.info(`[bajoseek:${account.accountId}] WebSocket connected and authenticated`);
        onReady?.();

        // Start heartbeat.
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

        // Handle pong (heartbeat response).
        if (msgType === "pong") {
          return;
        }

        // Handle server error notification.
        if (msgType === "error") {
          log?.error(`[bajoseek:${account.accountId}] Server error: code=${parsed.code}, message=${parsed.message}`);
          return;
        }

        // Handle user message.
        if (msgType === "message") {
          const event: InboundUserMessage = {
            type: "message",
            messageId: parsed.messageId as string,
            userId: parsed.userId as string,
            conversationId: parsed.conversationId as string,
            text: ((parsed.text as string) ?? "").slice(0, MAX_INBOUND_TEXT_LENGTH),
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
          // Normal close — the loop will reconnect.
          resolve();
        }
      });

      ws.on("error", (err) => {
        log?.error(`[bajoseek:${account.accountId}] WebSocket error: ${err.message}`);
        // An `error` event is always followed by `close` — no reject here.
      });

      // Handle handshake rejection (e.g. HTTP 401).
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
