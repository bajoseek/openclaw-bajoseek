# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A channel plugin for OpenClaw that connects AI assistants to the Bajoseek App via WebSocket. Published as `@bajoseek/openclaw-bajoseek` on npm. It supports both OpenClaw 3.13 (legacy) and 3.24+ (new Plugin SDK) through runtime version detection.

## Build Commands

```bash
pnpm install          # install dependencies (uses pnpm, node 22 via mise)
pnpm run build        # compile TypeScript (tsc, note: uses `|| true` to ignore errors)
pnpm run dev          # watch mode
```

No test framework is configured. No linter is configured.

## Architecture

**Plugin registration pattern**: `index.ts` exports a default object with `register(api)` that works with both old and new OpenClaw plugin loaders. `setup-entry.ts` is a separate entry for the setup wizard only.

**Dual-version compatibility**: `src/channel.ts` dynamically attaches both `setupWizard` (3.24+) and `onboarding` (3.13) adapters via `import().then()` at module load time. Each OpenClaw version ignores the field it doesn't recognize. Top-level `await` is intentionally avoided because OpenClaw's Jiti loader doesn't support it.

**Key modules**:
- `src/channel.ts` — Central `bajoseekPlugin` object with all adapters (config, setup, messaging, outbound, gateway, status). This is the main integration surface with OpenClaw.
- `src/gateway.ts` — WebSocket connection lifecycle: connect loop with exponential backoff, per-user message queues, heartbeat, and the inbound message handler that dispatches through OpenClaw's reply pipeline.
- `src/outbound.ts` — Functions for sending messages over WebSocket (`sendText`, `sendStreamChunk`, `sendStreamEnd`, `sendChunkedEnd`).
- `src/config.ts` — Account config resolution with 3-level token fallback: config field -> tokenFile on disk -> `BAJOSEEK_TOKEN` env var. Supports multi-account via `accounts` sub-map in config.
- `src/sdk-compat.ts` — Pure config-manipulation helpers that replicate functions from `openclaw/plugin-sdk/core` for 3.13 compatibility.
- `src/setup-surface.ts` / `src/setup-core.ts` — Interactive setup wizard for 3.24+.
- `src/onboarding.ts` — Legacy onboarding adapter for 3.13.

**Message flow**: Inbound messages from WebSocket are enqueued per-user (max 20 msgs/user, 10 concurrent users), then processed sequentially per user through OpenClaw's `dispatchReplyWithBufferedBlockDispatcher`. Outbound responses use block streaming (stream_chunk + stream_end) when enabled, or fallback chunked delivery (10k char chunks).

**Target address format**: `bajoseek:user:<userId>` — the messaging adapter normalizes shorthand forms like `user:alice` or just `alice`.

## Code Conventions

- Bilingual comments throughout: English followed by Chinese translation on the next line or after `——`.
- TypeScript with strict mode, ES2022 target, NodeNext module resolution.
- The plugin object (`bajoseekPlugin`) is typed as `any` to accommodate field differences between OpenClaw versions.
- All SDK-compat helpers are pure functions (no mutation of input config).
- `openclaw/plugin-sdk` is a peer dependency — types are imported from it but the package is not bundled.
