# Bajoseek OpenClaw Plugin

[中文文档](./README_zh.md)

A channel plugin for [OpenClaw](https://github.com/openclaw/openclaw) that connects AI assistants to the Bajoseek App via WebSocket.

## Compatibility

| OpenClaw Version | Support |
|---|---|
| 3.24+ (new Plugin SDK) | Fully supported — uses `ChannelSetupWizard` |
| 3.13 (legacy Plugin SDK) | Fully supported — uses `ChannelOnboardingAdapter` |

The plugin detects the OpenClaw version at runtime and automatically loads the appropriate setup adapter.

## Features

- **Real-time WebSocket Communication** — Bidirectional messaging between OpenClaw AI agents and Bajoseek users
- **Block Streaming** — Progressive chunked response delivery for better responsiveness on long replies
- **Auto-Reconnect** — Exponential backoff reconnection (1s -> 2s -> 5s -> 10s -> 30s -> 60s)
- **Per-User Message Queue** — Isolated queues per user (max 20 messages/user, 10 concurrent users)
- **Heartbeat** — Periodic ping every 30 seconds to keep connections alive
- **Multi-Account** — Run multiple Bajoseek bot accounts from a single OpenClaw instance
- **3-Level Token Fallback** — Config file -> token file -> environment variable
- **Connection Validation** — Setup wizard verifies botId and token against the server before saving
- **Inbound Message Limit** — Messages exceeding 100,000 characters are automatically truncated

## Quick Start

### Install

```bash
pnpm add @bajoseek/openclaw-bajoseek
```

### Configure

Set environment variables:

```bash
export BAJOSEEK_BOT_ID="your-bot-id"
export BAJOSEEK_TOKEN="your-token"
```

Or add to your OpenClaw config file:

```yaml
channels:
  bajoseek:
    enabled: true
    botId: "your-bot-id"
    token: "your-token"
```

### Interactive Setup

Run the OpenClaw onboard wizard — it will guide you through:

1. **BotID** — enter manually or use `BAJOSEEK_BOT_ID` env var
2. **Token** — enter manually or use `BAJOSEEK_TOKEN` env var
3. **WebSocket URL** — optional custom URL (default: `wss://ws.bajoseek.com`)
4. **Block Streaming** — enable/disable chunked replies
5. **Connection Validation** — automatically tests credentials against the server

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `BAJOSEEK_BOT_ID` | Bot ID (default account only) |
| `BAJOSEEK_TOKEN` | Auth token (default account only) |

### Config Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable/disable channel |
| `botId` | string | — | Bajoseek bot ID |
| `token` | string | — | Auth token |
| `tokenFile` | string | — | Path to file containing token |
| `wsUrl` | string | `wss://ws.bajoseek.com` | WebSocket server URL |
| `allowFrom` | string[] | `["*"]` | Message source allowlist |
| `blockStreaming` | boolean | `true` | Enable chunked streaming |
| `name` | string | — | Account display name |

### Multi-Account

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

## WebSocket Protocol

### Inbound (Server -> Plugin)

| Type | Fields | Description |
|---|---|---|
| `message` | `messageId`, `userId`, `conversationId`, `text`, `timestamp` | User message |
| `pong` | — | Heartbeat response |
| `error` | `code`, `message` | Server error |

### Outbound (Plugin -> Server)

| Type | Fields | Description |
|---|---|---|
| `stream_chunk` | `conversationId`, `text` | Partial response (non-final) |
| `stream_end` | `conversationId`, `text` | Final response block |
| `reply` | `to`, `text`, `replyToId?` | Direct reply message |
| `ping` | — | Heartbeat |

### Authentication

WebSocket upgrade headers:
- `X-Bot-Id: <botId>`
- `Authorization: Bearer <token>`

### Target Address Format

```
bajoseek:user:<userId>
```

Accepted inputs: `bajoseek:user:alice`, `user:alice`, or `alice`.

## Channel Capabilities

| Capability | Support |
|---|---|
| Direct Messages | Yes |
| Group Chat | No |
| Media | No |
| Reactions | No |
| Threads | No |
| Block Streaming | Yes |

## Development

### Build

```bash
pnpm install     # Install dependencies
pnpm run build   # Compile TypeScript
pnpm run dev     # Watch mode
```

> **Note:** `openclaw/plugin-sdk` is a peer dependency. Type errors from the SDK are expected during local builds without OpenClaw installed — `tsc || true` ensures JS output is still generated.

### Project Structure

```
index.ts              # Plugin entry point (register pattern, compatible with both versions)
setup-entry.ts        # Setup-only entry point
src/
  channel.ts          # ChannelPlugin implementation (dynamically loads setupWizard / onboarding)
  gateway.ts          # WebSocket connection & message dispatch
  outbound.ts         # Message sending utilities
  config.ts           # Account config resolution (3-level token fallback) & connection validation
  runtime.ts          # Plugin runtime singleton
  onboarding.ts       # Legacy ChannelOnboardingAdapter (OpenClaw 3.13)
  setup-surface.ts    # Interactive ChannelSetupWizard (OpenClaw 3.24+)
  setup-core.ts       # CLI setup adapter (OpenClaw 3.24+)
  sdk-compat.ts       # SDK compatibility layer (local config helpers)
  types.ts            # TypeScript interfaces
```

## License

MIT
