/**
 * ChannelPlugin implementation
 *
 * Defines `bajoseekPlugin`, the central plugin object registered with OpenClaw.
 *
 * The object is typed as `any` to accommodate field differences between OpenClaw versions:
 *   - Old (3.13): uses `onboarding: ChannelOnboardingAdapter`
 *   - New (3.24+): uses `setupWizard: ChannelSetupWizard`
 *
 * Both fields are dynamically attached at module load time via `await import()`.
 * Each version ignores the field it doesn't recognise, so attaching both is safe.
 */

import type {OpenClawConfig} from "openclaw/plugin-sdk";

import type {ResolvedBajoseekAccount} from "./types.js";
import {
  applyBajoseekAccountConfig,
  DEFAULT_ACCOUNT_ID,
  listBajoseekAccountIds,
  resolveBajoseekAccount,
  resolveDefaultBajoseekAccountId,
} from "./config.js";
import {sendText} from "./outbound.js";
import {startGateway, getWsConnection} from "./gateway.js";
import {
  applyAccountNameToChannelSection,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "./sdk-compat.js";

/**
 * Split long text into Markdown-friendly chunks.
 *
 * Priority: newline > space > hard cut.
 */
function chunkText(text: string, limit: number): string[] {
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
      // Hard cut.
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/* ════════════════════════════════════════════════════════════
 *  Plugin definition
 * ════════════════════════════════════════════════════════════ */

export const bajoseekPlugin: any = {
  id: "bajoseek",

  /** Channel metadata shown in the OpenClaw UI. */
  meta: {
    id: "bajoseek",
    label: "Bajoseek",
    selectionLabel: "Bajoseek",
    docsPath: "/docs/channels/bajoseek",
    blurb: "Connect to Bajoseek App via WebSocket",
    order: 60,
  },

  /** Supported capabilities. */
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: true,
  },

  /** Hints injected into the AI agent prompt. */
  agentPrompt: {
    messageToolHints: () => [
      "- Bajoseek is a chat channel. Always respond with text directly in the conversation.",
      "- Do NOT write content to files or use file-writing tools to produce your response. Send all content as chat messages.",
      "- If the user asks you to write or create content (stories, articles, code, etc.), output the full content directly in your reply text, do not save it to a file.",
      "- Bajoseek does not support media attachments, reactions, or threads.",
    ],
  },

  /** Config prefixes that trigger a plugin reload. */
  reload: { configPrefixes: ["channels.bajoseek"] },

  /* ── Config adapter ── */
  config: {
    /** List all account IDs that have a botId configured. */
    listAccountIds: (cfg: OpenClawConfig) => listBajoseekAccountIds(cfg),

    /** Resolve full account details. */
    resolveAccount: (cfg: OpenClawConfig, accountId: string) => resolveBajoseekAccount(cfg, accountId),

    /** Determine the default account. */
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultBajoseekAccountId(cfg),

    /** Enable or disable an account. */
    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        enabled,
        allowTopLevel: true,
      }),

    /** Remove an account from config. */
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        clearBaseFields: ["botId", "token", "tokenFile", "name"],
      }),

    /** Check whether an account has both botId and token. */
    isConfigured: (account: ResolvedBajoseekAccount) => Boolean(account?.botId && account?.token),

    /** Build a lightweight snapshot for UI display. */
    describeAccount: (account: ResolvedBajoseekAccount) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.botId && account?.token),
      tokenSource: account?.tokenSource,
    }),

    /** Resolve the allowFrom list for access control. */
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      const allowFrom = account.config?.allowFrom ?? [];
      return allowFrom.map((entry: string | number) => String(entry));
    },

    /** Format allowFrom entries for display (strip channel prefix). */
    formatAllowFrom: ({ allowFrom }: { allowFrom: (string | number)[] }) =>
      allowFrom
        .map((entry: string | number) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(/^bajoseek:/i, "")),
  },

  /* ── Setup adapter (CLI non-interactive) ── */
  setup: {
    /** Normalise the account ID from CLI input. */
    resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim().toLowerCase() || DEFAULT_ACCOUNT_ID,

    /** Set display name. */
    applyAccountName: ({ cfg, accountId, name }: { cfg: OpenClawConfig; accountId: string; name: string }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "bajoseek",
        accountId,
        name,
      }),

    /** Validate CLI input before applying. */
    validateInput: ({ input }: { input: any }) => {
      if (!input.botToken && !input.useEnv) {
        return "Bajoseek requires --bot-token <botId> --token <token> [--url <wsUrl>], or --use-env";
      }
      if (!input.token && !input.useEnv) {
        return "Bajoseek requires --token <token>";
      }
      return null;
    },

    /** Merge CLI input into config. */
    applyAccountConfig: ({ cfg, accountId, input }: { cfg: OpenClawConfig; accountId: string; input: any }) => {
      return applyBajoseekAccountConfig(cfg, accountId, {
        botId: input.botToken,
        token: input.token,
        tokenFile: input.tokenFile,
        name: input.name,
        wsUrl: input.url,
      });
    },
  },

  /* ── Messaging adapter ── */
  messaging: {
    /**
     * Normalise a target address to canonical form.
     *
     * Accepted inputs:
     *   - "bajoseek:user:userId" → direct message
     *   - "user:userId"          → direct message
     *   - "userId"               → direct message
     *
     * Returns `undefined` for unrecognised formats.
     */
    normalizeTarget: (target: string) => {
      const id = target.replace(/^bajoseek:/i, "");

      if (id.startsWith("user:")) {
        return `bajoseek:${id}`;
      }

      // Plain userId (non-empty, no colon).
      if (id && !id.includes(":")) {
        return `bajoseek:user:${id}`;
      }

      return undefined;
    },

    /** Target resolver hints. */
    targetResolver: {
      looksLikeId: (id: string): boolean => {
        if (/^bajoseek:user:/i.test(id)) return true;
        if (/^user:/i.test(id)) return true;
        return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
      },
      // Bajoseek target format: bajoseek:user:userId
      hint: "Bajoseek target format: bajoseek:user:userId",
    },
  },

  /* ── Outbound adapter ── */
  outbound: {
    deliveryMode: "direct",
    chunker: chunkText,
    chunkerMode: "markdown",
    /** Max characters per chunk. */
    textChunkLimit: 4000,

    /**
     * Send a text message to a Bajoseek user.
     */
    sendText: async ({ to, text, accountId, replyToId }: { to: string; text: string; accountId: string; replyToId?: string }) => {
      const result = await sendText({ to, text, accountId, replyToId });
      return {
        channel: "bajoseek" as const,
        messageId: result.messageId ?? "",
      };
    },
  },

  /* ── Gateway adapter ── */
  gateway: {
    /**
     * Start the WebSocket gateway for an account.
     */
    startAccount: async (ctx: any) => {
      const { account, abortSignal, log, cfg } = ctx;

      log?.info(`[bajoseek:${account.accountId}] Starting gateway — botId=${account.botId}, enabled=${account.enabled}, name=${account.name ?? "unnamed"}`);

      await startGateway({
        account,
        abortSignal,
        cfg,
        log,
        onReady: () => {
          log?.info(`[bajoseek:${account.accountId}] Gateway ready`);
          ctx.setStatus({
            ...ctx.getStatus(),
            running: true,
            connected: true,
            lastConnectedAt: Date.now(),
          });
        },
        onError: (error: Error) => {
          log?.error(`[bajoseek:${account.accountId}] Gateway error: ${error.message}`);
          ctx.setStatus({
            ...ctx.getStatus(),
            lastError: error.message,
          });
        },
      });
    },
  },

  /* ── Heartbeat adapter ── */
  // 健康检查适配器 —— 让 OpenClaw 能探测 WebSocket 连接状态
  heartbeat: {
    /**
     * Check whether the gateway WebSocket is connected and ready.
     * 检查 WebSocket 网关是否已连接并就绪。
     */
    checkReady: async ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
      const id = accountId ?? DEFAULT_ACCOUNT_ID;
      const ws = getWsConnection(id);
      if (ws && ws.readyState === 1 /* WebSocket.OPEN */) {
        return { ok: true, reason: "WebSocket connected" };
      }
      return { ok: false, reason: "WebSocket not connected" };
    },
  },

  /* ── Streaming adapter ── */
  // 流式输出合并参数 —— 控制 block streaming 的合并行为
  streaming: {
    blockStreamingCoalesceDefaults: {
      /** Minimum characters before flushing a coalesced block. */
      // 合并块的最小字符数
      minChars: 100,
      /** Idle time (ms) before flushing a partial block. */
      // 空闲刷新时间（毫秒）
      idleMs: 300,
    },
  },

  /* ── Status adapter ── */
  status: {
    /** Initial runtime status for a fresh account. */
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },

    /** Build an aggregated channel summary. */
    buildChannelSummary: ({ snapshot }: { snapshot: any }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastConnectedAt: snapshot.lastConnectedAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),

    /** Build a per-account snapshot. */
    buildAccountSnapshot: ({ account, runtime }: { account: ResolvedBajoseekAccount; runtime: any }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.botId && account.token),
      tokenSource: account.tokenSource,
      running: (runtime?.running as boolean) ?? false,
      connected: (runtime?.connected as boolean) ?? false,
      lastConnectedAt: (runtime?.lastConnectedAt as number | null) ?? null,
      lastError: (runtime?.lastError as string | null) ?? null,
      lastInboundAt: (runtime?.lastInboundAt as number | null) ?? null,
      lastOutboundAt: (runtime?.lastOutboundAt as number | null) ?? null,
    }),
  },
};

/* ════════════════════════════════════════════════════════════
 *  Dynamic setup-adapter loading
 *
 *  Attaches version-specific wizard adapters after module load.
 *
 *  Uses `.then()` instead of top-level `await` because OpenClaw's Jiti
 *  plugin loader does not support top-level await.
 *
 *  - setupWizard  → new OpenClaw (3.24+), depends on `openclaw/plugin-sdk/setup`
 *  - onboarding   → old OpenClaw (3.13), local implementation
 *
 *  Extra fields are silently ignored by each version.
 *
 *  Timing is safe: these adapters are only accessed during user-initiated
 *  `openclaw onboard`, well after plugin loading completes.
 * ════════════════════════════════════════════════════════════ */

import {bajoseekSetupWizard} from "./setup-surface.js";

// New version: setupWizard (synchronous — must be available at plugin load time)
bajoseekPlugin.setupWizard = bajoseekSetupWizard;

// Old version: onboarding (local ChannelOnboardingAdapter)
import("./onboarding.js")
  .then(({ bajoseekOnboardingAdapter }) => {
    bajoseekPlugin.onboarding = bajoseekOnboardingAdapter;
  })
  .catch(() => {
    // Onboarding module load failed — skip.
  });
