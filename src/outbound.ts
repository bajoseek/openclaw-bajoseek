/**
 * Outbound messaging utilities
 *
 * Provides functions for sending messages to the Bajoseek server via WebSocket.
 *
 * Message types:
 *   - stream_chunk: Partial response (non-final).
 *   - stream_end:   Final response chunk.
 *   - reply:        Direct reply message.
 */

import WebSocket from "ws";
import {getWsConnection} from "./gateway.js";

/**
 * Split long text into Markdown-friendly chunks.
 *
 * Split priority: newline → space → hard cut.
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

    // Try splitting at a newline.
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Fall back to space.
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Hard cut at limit.
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Send a single stream_chunk message (no splitting).
 */
export function sendStreamChunk(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text }));
}

/**
 * Send a single stream_end message (no splitting).
 */
export function sendStreamEnd(ws: WebSocket, conversationId: string, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: text || "" }));
}

/**
 * Split text by chunkSize, then send: first N-1 chunks as stream_chunk, last as stream_end.
 *
 * When text length <= chunkSize, equivalent to a single stream_end.
 */
export function sendChunkedEnd(ws: WebSocket, conversationId: string, text: string, chunkSize: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const chunks = text ? splitText(text, chunkSize) : [""];

  // Send intermediate chunks.
  for (let i = 0; i < chunks.length - 1; i++) {
    ws.send(JSON.stringify({ type: "stream_chunk", conversationId, text: chunks[i] }));
  }

  // Send final chunk.
  ws.send(JSON.stringify({ type: "stream_end", conversationId, text: chunks[chunks.length - 1] }));
}

/* ════════════════════════════════════════════════════════════
 *  Outbound sendText — used by channel.outbound adapter
 * ════════════════════════════════════════════════════════════ */

/** Options for sending a text message. */
export interface SendTextOptions {
  /** Target address (e.g. "bajoseek:user:alice"). */
  to: string;
  /** Message text. */
  text: string;
  /** Account ID to send from. */
  accountId?: string | null;
  /** Optional ID of the message being replied to. */
  replyToId?: string | null;
}

/** Result of an outbound send operation. */
export interface OutboundResult {
  /** Generated message ID. */
  messageId?: string;
  /** Error description (if failed). */
  error?: string;
}

/** Auto-increment counter for generating unique message IDs. */
let messageCounter = 0;

/** Generate a unique message ID. */
function generateMessageId(): string {
  return `bj_${Date.now()}_${++messageCounter}`;
}

/**
 * Send a text message to a Bajoseek user via WebSocket.
 *
 * @returns The generated message ID on success, or an error description.
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
