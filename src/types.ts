/**
 * Bajoseek 账户配置（用户在 OpenClaw 配置文件中填写）
 */
export interface BajoseekAccountConfig {
  enabled?: boolean;
  name?: string;
  botId?: string;
  token?: string;
  tokenFile?: string;
  /** 可选覆盖默认 WebSocket URL */
  wsUrl?: string;
  allowFrom?: string[];
  /** 是否开启框架 block streaming（分块流式回复） */
  blockStreaming?: boolean;
}

/**
 * 解析后的 Bajoseek 账户
 */
export interface ResolvedBajoseekAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  botId: string;
  token: string;
  tokenSource: "config" | "file" | "env" | "none";
  wsUrl: string;
  config: BajoseekAccountConfig;
}

/**
 * WebSocket 协议消息类型
 */

/** 服务端推送的用户消息 */
export interface InboundUserMessage {
  type: "message";
  messageId: string;
  userId: string;
  conversationId: string;
  text: string;
  timestamp: number;
}

/** 流式回复片段（AI 生成中） */
export interface StreamChunkMessage {
  type: "stream_chunk";
  conversationId: string;
  text: string;
}

/** 流式回复完成信号 */
export interface StreamEndMessage {
  type: "stream_end";
  conversationId: string;
  text: string;
}

/** 普通回复（sendText 兜底） */
export interface ReplyMessage {
  type: "reply";
  to: string;
  text: string;
  replyToId?: string;
}

/** 服务端错误通知 */
export interface ErrorMessage {
  type: "error";
  code: number;
  message: string;
}

/** 心跳 */
export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

/** 所有协议消息的联合类型 */
export type BajoseekProtocolMessage =
  | InboundUserMessage
  | StreamChunkMessage
  | StreamEndMessage
  | ReplyMessage
  | ErrorMessage
  | PingMessage
  | PongMessage;
