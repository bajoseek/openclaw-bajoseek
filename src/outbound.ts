import WebSocket from "ws";
import { getWsConnection } from "./gateway.js";

/**
 * 将长文本按 Markdown 友好的方式拆分为多段。
 * 优先在换行符处切分，其次空格，最后硬切。
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

    // 优先在换行处分割
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * 发送单条 stream_chunk 消息（不拆分）
 */
export function sendStreamChunk(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text }));
}

/**
 * 发送单条 stream_end 消息（不拆分）
 */
export function sendStreamEnd(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: text || "" }));
}

/**
 * 将文本按 chunkSize 拆分后发送：前 N-1 块为 stream_chunk，最后一块为 stream_end。
 * 当文本长度 <= chunkSize 时等价于直接发一条 stream_end。
 */
export function sendChunkedEnd(ws: WebSocket, conversationId: string, text: string, chunkSize: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const chunks = text ? splitText(text, chunkSize) : [""];

  for (let i = 0; i < chunks.length - 1; i++) {
    ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text: chunks[i] }));
  }

  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: chunks[chunks.length - 1] }));
}

// ============ outbound sendText（供 channel.outbound 使用） ============

export interface SendTextOptions {
  to: string;
  text: string;
  accountId?: string | null;
  replyToId?: string | null;
}

export interface OutboundResult {
  messageId?: string;
  error?: string;
}

let messageCounter = 0;
function generateMessageId(): string {
  return `bj_${Date.now()}_${++messageCounter}`;
}

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
