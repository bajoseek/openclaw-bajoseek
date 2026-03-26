/**
 * Bajoseek account configuration types — Bajoseek 账户配置类型
 *
 * Defines the shape of user-written config and the resolved runtime account.
 * 定义用户编写的配置结构及解析后的运行时账户。
 */

/**
 * Raw account config as written in the OpenClaw config file.
 * 用户在 OpenClaw 配置文件中填写的原始账户配置。
 */
export interface BajoseekAccountConfig {
  /** Enable or disable this account. / 启用或禁用此账户。 */
  enabled?: boolean;
  /** Display name for this account. / 此账户的显示名称。 */
  name?: string;
  /** Bajoseek bot ID. / Bajoseek 机器人 ID。 */
  botId?: string;
  /** Auth token (plain text in config). / 认证 Token（配置中的明文）。 */
  token?: string;
  /** Path to a file containing the auth token. / 存放 Token 的文件路径。 */
  tokenFile?: string;
  /** Custom WebSocket URL — overrides the default `wss://ws.bajoseek.com`. / 自定义 WebSocket 地址——覆盖默认值。 */
  wsUrl?: string;
  /** Message source allowlist. / 消息来源白名单。 */
  allowFrom?: string[];
  /** Enable block streaming (chunked progressive replies). / 启用分块流式回复。 */
  blockStreaming?: boolean;
}

/**
 * Fully resolved account ready for runtime use.
 * 完全解析后的账户，供运行时使用。
 *
 * Token resolution follows a 3-level fallback: config → tokenFile → env variable.
 * Token 解析遵循三级回退：配置文件 → Token 文件 → 环境变量。
 */
export interface ResolvedBajoseekAccount {
  /** Account identifier ("default" for the top-level account). / 账户标识（顶层账户为 "default"）。 */
  accountId: string;
  /** Optional display name. / 可选的显示名称。 */
  name?: string;
  /** Whether this account is enabled. / 此账户是否启用。 */
  enabled: boolean;
  /** Resolved bot ID. / 解析后的机器人 ID。 */
  botId: string;
  /** Resolved auth token. / 解析后的认证 Token。 */
  token: string;
  /** Where the token was resolved from. / Token 的来源。 */
  tokenSource: "config" | "file" | "env" | "none";
  /** Effective WebSocket URL. / 生效的 WebSocket 地址。 */
  wsUrl: string;
  /** The raw config section for this account. / 此账户的原始配置区段。 */
  config: BajoseekAccountConfig;
}

/* ── WebSocket protocol message types / WebSocket 协议消息类型 ── */

/** Inbound user message pushed by the server. / 服务端推送的用户消息。 */
export interface InboundUserMessage {
  type: "message";
  messageId: string;
  userId: string;
  conversationId: string;
  text: string;
  timestamp: number;
}

/** Streaming reply chunk (AI still generating). / 流式回复片段（AI 生成中）。 */
export interface StreamChunkMessage {
  type: "stream_chunk";
  conversationId: string;
  text: string;
}

/** Stream end signal — final chunk of a reply. / 流式结束信号——回复的最后一段。 */
export interface StreamEndMessage {
  type: "stream_end";
  conversationId: string;
  text: string;
}

/** Direct reply (used by outbound `sendText`). / 直接回复（由出站 `sendText` 使用）。 */
export interface ReplyMessage {
  type: "reply";
  to: string;
  text: string;
  replyToId?: string;
}

/** Server-side error notification. / 服务端错误通知。 */
export interface ErrorMessage {
  type: "error";
  code: number;
  message: string;
}

/** Heartbeat ping. / 心跳 ping。 */
export interface PingMessage {
  type: "ping";
}

/** Heartbeat pong. / 心跳 pong。 */
export interface PongMessage {
  type: "pong";
}

/** Union of all protocol messages. / 所有协议消息的联合类型。 */
export type BajoseekProtocolMessage =
  | InboundUserMessage
  | StreamChunkMessage
  | StreamEndMessage
  | ReplyMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;
