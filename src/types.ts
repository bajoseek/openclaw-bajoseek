/**
 * Bajoseek account configuration types
 *
 * Defines the shape of user-written config and the resolved runtime account.
 */

/**
 * Raw account config as written in the OpenClaw config file.
 */
export interface BajoseekAccountConfig {
  /** Enable or disable this account. */
  enabled?: boolean;
  /** Display name for this account. */
  name?: string;
  /** Bajoseek bot ID. */
  botId?: string;
  /** Auth token (plain text in config). */
  token?: string;
  /** Path to a file containing the auth token. */
  tokenFile?: string;
  /** Custom WebSocket URL — overrides the default `wss://ws.bajoseek.com`. */
  wsUrl?: string;
  /** Message source allowlist. */
  allowFrom?: string[];
  /** Enable block streaming (chunked progressive replies). */
  blockStreaming?: boolean;
}

/**
 * Fully resolved account ready for runtime use.
 *
 * Token resolution follows a 3-level fallback: config → tokenFile → env variable.
 */
export interface ResolvedBajoseekAccount {
  /** Account identifier ("default" for the top-level account). */
  accountId: string;
  /** Optional display name. */
  name?: string;
  /** Whether this account is enabled. */
  enabled: boolean;
  /** Resolved bot ID. */
  botId: string;
  /** Resolved auth token. */
  token: string;
  /** Where the token was resolved from. */
  tokenSource: "config" | "file" | "env" | "none";
  /** Effective WebSocket URL. */
  wsUrl: string;
  /** The raw config section for this account. */
  config: BajoseekAccountConfig;
}

/* ── WebSocket protocol message types ── */

/** Inbound user message pushed by the server. */
export interface InboundUserMessage {
  type: "message";
  messageId: string;
  userId: string;
  conversationId: string;
  text: string;
  timestamp: number;
}

/** Streaming reply chunk (AI still generating). */
export interface StreamChunkMessage {
  type: "stream_chunk";
  conversationId: string;
  text: string;
}

/** Stream end signal — final chunk of a reply. */
export interface StreamEndMessage {
  type: "stream_end";
  conversationId: string;
  text: string;
}

/** Direct reply (used by outbound `sendText`). */
export interface ReplyMessage {
  type: "reply";
  to: string;
  text: string;
  replyToId?: string;
}

/** Server-side error notification. */
export interface ErrorMessage {
  type: "error";
  code: number;
  message: string;
}

/** Heartbeat ping. */
export interface PingMessage {
  type: "ping";
}

/** Heartbeat pong. */
export interface PongMessage {
  type: "pong";
}

/** Stop generation request from client. */
// 客户端请求停止生成
export interface StopMessage {
  type: "stop";
  conversationId: string;
}

/** Union of all protocol messages. */
export type BajoseekProtocolMessage =
  | InboundUserMessage
  | StreamChunkMessage
  | StreamEndMessage
  | ReplyMessage
  | ErrorMessage
  | PingMessage
  | PongMessage
  | StopMessage;
