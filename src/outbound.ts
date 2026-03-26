/**
 * Outbound messaging utilities — 出站消息工具
 *
 * Provides functions for sending messages to the Bajoseek server via WebSocket.
 * 提供通过 WebSocket 向 Bajoseek 服务端发送消息的函数。
 *
 * Message types / 消息类型:
 *   - stream_chunk: Partial response (non-final). / 部分回复（非最终）。
 *   - stream_end:   Final response chunk. / 最终回复段。
 *   - reply:        Direct reply message. / 直接回复消息。
 */
import WebSocket from "ws";
import { getWsConnection } from "./gateway.js";

/**
 * Split long text into Markdown-friendly chunks.
 * 将长文本按 Markdown 友好方式拆分为多段。
 *
 * Split priority: newline → space → hard cut.
 * 拆分优先级：换行符 → 空格 → 硬切。
 */
export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    // Try splitting at a newline. / 优先在换行处分割。
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Fall back to space. / 回退到空格。
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Hard cut at limit. / 在限制处硬切。
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Send a single stream_chunk message (no splitting).
 * 发送单条 stream_chunk 消息（不拆分）。
 */
export function sendStreamChunk(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text }));
}

/**
 * Send a single stream_end message (no splitting).
 * 发送单条 stream_end 消息（不拆分）。
 */
export function sendStreamEnd(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: text || "" }));
}

/**
 * Split text by chunkSize, then send: first N-1 chunks as stream_chunk, last as stream_end.
 * 按 chunkSize 拆分文本后发送：前 N-1 块为 stream_chunk，最后一块为 stream_end。
 *
 * When text length <= chunkSize, equivalent to a single stream_end.
 * 文本长度 <= chunkSize 时，等价于直接发一条 stream_end。
 */
export function sendChunkedEnd(ws: WebSocket, conversationId: string, text: string, chunkSize: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const chunks = text ? splitText(text, chunkSize) : [""];

  // Send intermediate chunks. / 发送中间分块。
  for (let i = 0; i < chunks.length - 1; i++) {
    ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text: chunks[i] }));
  }

  // Send final chunk. / 发送最终分块。
  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: chunks[chunks.length - 1] }));
}

/* ════════════════════════════════════════════════════════════
 *  Outbound sendText — used by channel.outbound adapter
 *  出站 sendText——供 channel.outbound 适配器使用
 * ════════════════════════════════════════════════════════════ */

/** Options for sending a text message. / 发送文本消息的选项。 */
export interface SendTextOptions {
  /** Target address (e.g. "bajoseek:user:alice"). / 目标地址。 */
  to: string;
  /** Message text. / 消息文本。 */
  text: string;
  /** Account ID to send from. / 发送方账户 ID。 */
  accountId?: string | null;
  /** Optional ID of the message being replied to. / 可选的被回复消息 ID。 */
  replyToId?: string | null;
}

/** Result of an outbound send operation. / 出站发送操作的结果。 */
export interface OutboundResult {
  /** Generated message ID. / 生成的消息 ID。 */
  messageId?: string;
  /** Error description (if failed). / 错误描述（如失败）。 */
  error?: string;
}

/** Auto-increment counter for generating unique message IDs. / 自增计数器，用于生成唯一消息 ID。 */
let messageCounter = 0;

/** Generate a unique message ID. / 生成唯一消息 ID。 */
function generateMessageId(): string {
  return `bj_${Date.now()}_${++messageCounter}`;
}

/**
 * Send a text message to a Bajoseek user via WebSocket.
 * 通过 WebSocket 向 Bajoseek 用户发送文本消息。
 *
 * @returns The generated message ID on success, or an error description.
 *          成功时返回生成的消息 ID，失败时返回错误描述。
 */
export async function sendText(opts: SendTextOptions): Promise<OutboundResult> {
  const { to, text, accountId } = opts;
  const resolvedAccountId = accountId ?? "default";

  const ws = getWsConnection(resolvedAccountId);
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return { error: `WebSocket not connected for account ${resolvedAccountId}` };
  }

  const messageId = generateMessageId();

  ws.send(JSON.stringify({
    type: "reply",
    to,
    text,
    replyToId: opts.replyToId ?? undefined,
  }));

  return { messageId };
}
