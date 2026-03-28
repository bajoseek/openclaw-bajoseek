# Bajoseek OpenClaw 插件

[English](./README.md)

[OpenClaw](https://github.com/openclaw/openclaw) 的频道插件，通过 WebSocket 将 AI 助手连接到 Bajoseek App。

## 兼容性

| OpenClaw 版本 | 支持情况 |
|---|---|
| 3.24+（新 Plugin SDK） | 完全支持——使用 `ChannelSetupWizard` |
| 3.13（旧 Plugin SDK） | 完全支持——使用 `ChannelOnboardingAdapter` |

插件在运行时自动检测 OpenClaw 版本，加载对应的配置适配器。

## 功能特性

- **实时 WebSocket 通信** — OpenClaw AI 与 Bajoseek 用户之间的双向消息通信
- **分块流式回复** — 长回复渐进式分块推送，提升响应体验
- **自动重连** — 指数退避重连机制（1s → 2s → 5s → 10s → 30s → 60s）
- **按用户隔离的消息队列** — 每用户独立队列（单用户上限 20 条消息，最多 10 个用户并发处理）
- **心跳保活** — 每 30 秒发送 ping，保持连接活跃
- **多账户支持** — 单个 OpenClaw 实例运行多个 Bajoseek 机器人账户
- **三级 Token 回退** — 配置文件 → 文件读取 → 环境变量

## 快速开始

### 安装

```bash
npm install @bajoseek/openclaw-bajoseek
```

### 配置

设置环境变量：

```bash
export BAJOSEEK_BOT_ID="your-bot-id"
export BAJOSEEK_TOKEN="your-token"
```

或在 OpenClaw 配置文件中添加：

```yaml
channels:
  bajoseek:
    enabled: true
    botId: "your-bot-id"
    token: "your-token"
```

### 交互式配置

运行 OpenClaw 的 onboard 向导，按提示输入 BotID、Token，可选配置 WebSocket 地址和分块流式回复。

## 配置说明

### 环境变量

| 变量 | 说明 |
|---|---|
| `BAJOSEEK_BOT_ID` | 机器人 ID（仅默认账户） |
| `BAJOSEEK_TOKEN` | 认证 Token（仅默认账户） |

### 配置字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | 启用/禁用频道 |
| `botId` | string | — | Bajoseek 机器人 ID |
| `token` | string | — | 认证 Token |
| `tokenFile` | string | — | Token 文件路径 |
| `wsUrl` | string | `wss://ws.bajoseek.com` | WebSocket 服务器地址 |
| `allowFrom` | string[] | `["*"]` | 消息来源白名单 |
| `blockStreaming` | boolean | `true` | 启用分块流式回复 |
| `name` | string | — | 账户显示名称 |

### 多账户配置

```yaml
channels:
  bajoseek:
    enabled: true
    botId: "default-bot-id"
    token: "default-token"
    accounts:
      staging:
        botId: "staging-bot-id"
        token: "staging-token"
        wsUrl: "wss://staging.bajoseek.com"
      production:
        botId: "prod-bot-id"
        tokenFile: "/secrets/bajoseek-token"
```

## WebSocket 协议

### 入站消息（服务端 → 插件）

| 类型 | 字段 | 说明 |
|---|---|---|
| `message` | `messageId`, `userId`, `conversationId`, `text`, `timestamp` | 用户消息 |
| `pong` | — | 心跳响应 |
| `error` | `code`, `message` | 服务端错误通知 |

### 出站消息（插件 → 服务端）

| 类型 | 字段 | 说明 |
|---|---|---|
| `stream_chunk` | `conversationId`, `text` | 流式回复片段（非最终块） |
| `stream_end` | `conversationId`, `text` | 流式回复结束 |
| `reply` | `to`, `text`, `replyToId?` | 直接回复消息 |
| `ping` | — | 心跳 |

### 认证方式

WebSocket 握手请求头：
- `X-Bot-Id: <botId>`
- `Authorization: Bearer <token>`

### 目标地址格式

```
bajoseek:user:<userId>
```

支持的输入格式：`bajoseek:user:alice`、`user:alice` 或直接输入 `alice`。

## 频道能力

| 能力 | 是否支持 |
|---|---|
| 私聊 | 是 |
| 群聊 | 否 |
| 多媒体 | 否 |
| 表情回应 | 否 |
| 话题/线程 | 否 |
| 分块流式回复 | 是 |

## 开发

### 构建

```bash
npm run build    # 编译 TypeScript
npm run dev      # 监听模式
```

### 项目结构

```
index.ts              # 插件入口（register 模式，兼容新旧版本）
setup-entry.ts        # Setup 专用入口
src/
  channel.ts          # ChannelPlugin 实现（动态加载 setupWizard / onboarding）
  gateway.ts          # WebSocket 连接与消息分发
  outbound.ts         # 消息发送工具
  config.ts           # 账户配置解析（三级 Token 回退）
  runtime.ts          # 插件运行时单例
  onboarding.ts       # 旧版 ChannelOnboardingAdapter（OpenClaw 3.13）
  setup-surface.ts    # 新版交互式 ChannelSetupWizard（OpenClaw 3.24+）
  setup-core.ts       # CLI 配置适配器（OpenClaw 3.24+）
  sdk-compat.ts       # SDK 兼容层（本地配置辅助函数）
  types.ts            # TypeScript 类型定义
```

## 许可证

MIT
