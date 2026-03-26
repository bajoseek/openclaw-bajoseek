/**
 * ChannelPlugin implementation — ChannelPlugin 核心实现
 *
 * Defines `bajoseekPlugin`, the central plugin object registered with OpenClaw.
 * 定义 `bajoseekPlugin`，向 OpenClaw 注册的核心插件对象。
 *
 * The object is typed as `any` to accommodate field differences between OpenClaw versions:
 * 类型为 `any` 以兼容新旧版 OpenClaw 的字段差异：
 *   - Old (3.13): uses `onboarding: ChannelOnboardingAdapter`
 *     旧版 (3.13): 使用 `onboarding: ChannelOnboardingAdapter`
 *   - New (3.24+): uses `setupWizard: ChannelSetupWizard`
 *     新版 (3.24+): 使用 `setupWizard: ChannelSetupWizard`
 *
 * Both fields are dynamically attached at module load time via `await import()`.
 * Each version ignores the field it doesn't recognise, so attaching both is safe.
 * 两个字段在模块加载时通过 `await import()` 动态挂载。
 * 各版本会忽略不识别的字段，因此同时挂载两者是安全的。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { ResolvedBajoseekAccount } from "./types.js";
import {
  DEFAULT_ACCOUNT_ID,
  listBajoseekAccountIds,
  resolveBajoseekAccount,
  applyBajoseekAccountConfig,
  resolveDefaultBajoseekAccountId,
} from "./config.js";
import { sendText } from "./outbound.js";
import { startGateway } from "./gateway.js";
import {
  applyAccountNameToChannelSection,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "./sdk-compat.js";

/**
 * Split long text into Markdown-friendly chunks.
 * 将长文本按 Markdown 友好方式拆分为多段。
 *
 * Priority: newline > space > hard cut.
 * 优先级：换行符 > 空格 > 硬切。
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

    // Try splitting at a newline. / 尝试在换行处分割。
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Fall back to space. / 回退到空格。
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt <= 0 || splitAt < limit * 0.5) {
      // Hard cut. / 硬切。
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

/* ════════════════════════════════════════════════════════════
 *  Plugin definition / 插件定义
 * ════════════════════════════════════════════════════════════ */

export const bajoseekPlugin: any = {
  id: "bajoseek",

  /** Channel metadata shown in the OpenClaw UI. / OpenClaw UI 中展示的频道元数据。 */
  meta: {
    id: "bajoseek",
    label: "Bajoseek",
    selectionLabel: "Bajoseek",
    docsPath: "/docs/channels/bajoseek",
    blurb: "Connect to Bajoseek App via WebSocket",
    order: 60,
  },

  /** Supported capabilities. / 支持的能力。 */
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: true,
  },

  /** Hints injected into the AI agent prompt. / 注入 AI Agent 提示词的提示。 */
  agentPrompt: {
    messageToolHints: () => [
      "- Bajoseek is a chat channel. Always respond with text directly in the conversation.",
      "- Do NOT write content to files or use file-writing tools to produce your response. Send all content as chat messages.",
      "- If the user asks you to write or create content (stories, articles, code, etc.), output the full content directly in your reply text, do not save it to a file.",
      "- Bajoseek does not support media attachments, reactions, or threads.",
    ],
  },

  /** Config prefixes that trigger a plugin reload. / 触发插件重新加载的配置前缀。 */
  reload: { configPrefixes: ["channels.bajoseek"] },

  /* ── Config adapter / 配置适配器 ── */
  config: {
    /** List all account IDs that have a botId configured. / 列出所有已配置 botId 的账户 ID。 */
    listAccountIds: (cfg: OpenClawConfig) => listBajoseekAccountIds(cfg),

    /** Resolve full account details. / 解析完整的账户详情。 */
    resolveAccount: (cfg: OpenClawConfig, accountId: string) => resolveBajoseekAccount(cfg, accountId),

    /** Determine the default account. / 确定默认账户。 */
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultBajoseekAccountId(cfg),

    /** Enable or disable an account. / 启用或禁用账户。 */
    setAccountEnabled: ({ cfg, accountId, enabled }: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        enabled,
        allowTopLevel: true,
      }),

    /** Remove an account from config. / 从配置中移除账户。 */
    deleteAccount: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        clearBaseFields: ["botId", "token", "tokenFile", "name"],
      }),

    /** Check whether an account has both botId and token. / 检查账户是否同时配置了 botId 和 token。 */
    isConfigured: (account: ResolvedBajoseekAccount) => Boolean(account?.botId && account?.token),

    /** Build a lightweight snapshot for UI display. / 构建用于 UI 展示的轻量快照。 */
    describeAccount: (account: ResolvedBajoseekAccount) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.botId && account?.token),
      tokenSource: account?.tokenSource,
    }),

    /** Resolve the allowFrom list for access control. / 解析用于访问控制的 allowFrom 列表。 */
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId: string }) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      const allowFrom = account.config?.allowFrom ?? [];
      return allowFrom.map((entry: string | number) => String(entry));
    },

    /** Format allowFrom entries for display (strip channel prefix). / 格式化 allowFrom 条目用于展示（去除频道前缀）。 */
    formatAllowFrom: ({ allowFrom }: { allowFrom: (string | number)[] }) =>
      allowFrom
        .map((entry: string | number) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(/^bajoseek:/i, "")),
  },

  /* ── Setup adapter (CLI non-interactive) / Setup 适配器（CLI 非交互模式） ── */
  setup: {
    /** Normalise the account ID from CLI input. / 规范化 CLI 输入的账户 ID。 */
    resolveAccountId: ({ accountId }: { accountId?: string }) => accountId?.trim().toLowerCase() || DEFAULT_ACCOUNT_ID,

    /** Set display name. / 设置显示名称。 */
    applyAccountName: ({ cfg, accountId, name }: { cfg: OpenClawConfig; accountId: string; name: string }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "bajoseek",
        accountId,
        name,
      }),

    /** Validate CLI input before applying. / 应用前校验 CLI 输入。 */
    validateInput: ({ input }: { input: any }) => {
      if (!input.botToken && !input.useEnv) {
        return "Bajoseek requires --bot-token <botId> --token <token> [--url <wsUrl>], or --use-env";
      }
      if (!input.token && !input.useEnv) {
        return "Bajoseek requires --token <token>";
      }
      return null;
    },

    /** Merge CLI input into config. / 将 CLI 输入合并到配置中。 */
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

  /* ── Messaging adapter / 消息适配器 ── */
  messaging: {
    /**
     * Normalise a target address to canonical form.
     * 将目标地址规范化为标准格式。
     *
     * Accepted inputs / 接受的输入:
     *   - "bajoseek:user:userId" → direct message / 私聊
     *   - "user:userId"          → direct message / 私聊
     *   - "userId"               → direct message / 私聊
     *
     * Returns `undefined` for unrecognised formats.
     * 无法识别的格式返回 `undefined`。
     */
    normalizeTarget: (target: string) => {
      const id = target.replace(/^bajoseek:/i, "");

      if (id.startsWith("user:")) {
        return `bajoseek:${id}`;
      }

      // Plain userId (non-empty, no colon). / 纯 userId（非空且不含冒号）。
      if (id && !id.includes(":")) {
        return `bajoseek:user:${id}`;
      }

      return undefined;
    },

    /** Target resolver hints. / 目标地址解析提示。 */
    targetResolver: {
      looksLikeId: (id: string): boolean => {
        if (/^bajoseek:user:/i.test(id)) return true;
        if (/^user:/i.test(id)) return true;
        return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
      },
      hint: "Bajoseek target format / Bajoseek 目标格式: bajoseek:user:userId",
    },
  },

  /* ── Outbound adapter / 出站消息适配器 ── */
  outbound: {
    deliveryMode: "direct",
    chunker: chunkText,
    chunkerMode: "markdown",
    /** Max characters per chunk. / 每段最大字符数。 */
    textChunkLimit: 4000,

    /**
     * Send a text message to a Bajoseek user.
     * 向 Bajoseek 用户发送文本消息。
     */
    sendText: async ({ to, text, accountId, replyToId }: { to: string; text: string; accountId: string; replyToId?: string }) => {
      const result = await sendText({ to, text, accountId, replyToId });
      return {
        channel: "bajoseek" as const,
        messageId: result.messageId ?? "",
      };
    },
  },

  /* ── Gateway adapter / 网关适配器 ── */
  gateway: {
    /**
     * Start the WebSocket gateway for an account.
     * 为一个账户启动 WebSocket 网关。
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

  /* ── Status adapter / 状态适配器 ── */
  status: {
    /** Initial runtime status for a fresh account. / 新账户的初始运行时状态。 */
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },

    /** Build an aggregated channel summary. / 构建聚合频道摘要。 */
    buildChannelSummary: ({ snapshot }: { snapshot: any }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastConnectedAt: snapshot.lastConnectedAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),

    /** Build a per-account snapshot. / 构建单账户快照。 */
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
 *  Dynamic setup-adapter loading / 动态加载配置向导适配器
 *
 *  Attaches version-specific wizard adapters after module load.
 *  模块加载后挂载版本特定的向导适配器。
 *
 *  Uses `.then()` instead of top-level `await` because OpenClaw's Jiti
 *  plugin loader does not support top-level await.
 *  使用 `.then()` 而非顶层 `await`，因为 OpenClaw 的 Jiti 插件加载器不支持顶层 await。
 *
 *  - setupWizard  → new OpenClaw (3.24+), depends on `openclaw/plugin-sdk/setup`
 *                    新版 (3.24+)，依赖 `openclaw/plugin-sdk/setup`
 *  - onboarding   → old OpenClaw (3.13), local implementation
 *                    旧版 (3.13)，本地实现
 *
 *  Extra fields are silently ignored by each version.
 *  多余字段会被各自版本静默忽略。
 *
 *  Timing is safe: these adapters are only accessed during user-initiated
 *  `openclaw onboard`, well after plugin loading completes.
 *  时序安全：这些适配器仅在用户发起 `openclaw onboard` 时访问，远在插件加载完成之后。
 * ════════════════════════════════════════════════════════════ */

// New version: setupWizard (from openclaw/plugin-sdk/setup)
// 新版：setupWizard（来自 openclaw/plugin-sdk/setup）
import("./setup-surface.js")
  .then(({ bajoseekSetupWizard }) => {
    bajoseekPlugin.setupWizard = bajoseekSetupWizard;
  })
  .catch(() => {
    // `openclaw/plugin-sdk/setup` not available (old version) — skip.
    // 旧版不存在 `openclaw/plugin-sdk/setup`——跳过。
  });

// Old version: onboarding (local ChannelOnboardingAdapter)
// 旧版：onboarding（本地 ChannelOnboardingAdapter 实现）
import("./onboarding.js")
  .then(({ bajoseekOnboardingAdapter }) => {
    bajoseekPlugin.onboarding = bajoseekOnboardingAdapter;
  })
  .catch(() => {
    // Onboarding module load failed — skip.
    // Onboarding 模块加载失败——跳过。
  });
