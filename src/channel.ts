import {
  type ChannelPlugin,
  type OpenClawConfig,
  applyAccountNameToChannelSection,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk";

import type { ResolvedBajoseekAccount } from "./types.js";
import { DEFAULT_ACCOUNT_ID, listBajoseekAccountIds, resolveBajoseekAccount, applyBajoseekAccountConfig, resolveDefaultBajoseekAccountId } from "./config.js";
import { sendText } from "./outbound.js";
import { startGateway } from "./gateway.js";
import { bajoseekOnboardingAdapter } from "./onboarding.js";

/**
 * 简单的文本分块函数
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

    // 尝试在换行处分割
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

export const bajoseekPlugin: ChannelPlugin<ResolvedBajoseekAccount> = {
  id: "bajoseek",
  meta: {
    id: "bajoseek",
    label: "Bajoseek",
    selectionLabel: "Bajoseek",
    docsPath: "/docs/channels/bajoseek",
    blurb: "Connect to Bajoseek App via WebSocket",
    order: 60,
  },
  capabilities: {
    chatTypes: ["direct"],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Bajoseek is a chat channel. Always respond with text directly in the conversation.",
      "- Do NOT write content to files or use file-writing tools to produce your response. Send all content as chat messages.",
      "- If the user asks you to write or create content (stories, articles, code, etc.), output the full content directly in your reply text, do not save it to a file.",
      "- Bajoseek does not support media attachments, reactions, or threads.",
    ],
  },
  reload: { configPrefixes: ["channels.bajoseek"] },
  onboarding: bajoseekOnboardingAdapter,

  config: {
    listAccountIds: (cfg) => listBajoseekAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveBajoseekAccount(cfg, accountId),
    defaultAccountId: (cfg) => resolveDefaultBajoseekAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "bajoseek",
        accountId,
        clearBaseFields: ["botId", "token", "tokenFile", "name"],
      }),
    isConfigured: (account) => Boolean(account?.botId && account?.token),
    describeAccount: (account) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: Boolean(account?.botId && account?.token),
      tokenSource: account?.tokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: OpenClawConfig; accountId?: string | null }) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      const allowFrom = account.config?.allowFrom ?? [];
      return allowFrom.map((entry: string | number) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }: { allowFrom: Array<string | number> }) =>
      allowFrom
        .map((entry: string | number) => String(entry).trim())
        .filter(Boolean)
        .map((entry: string) => entry.replace(/^bajoseek:/i, "")),
  },
  setup: {
    resolveAccountId: ({ accountId }) => accountId?.trim().toLowerCase() || DEFAULT_ACCOUNT_ID,
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "bajoseek",
        accountId,
        name,
      }),
    validateInput: ({ input }) => {
      if (!input.botToken && !input.useEnv) {
        return "Bajoseek requires --bot-token <botId> --token <token> [--url <wsUrl>], or --use-env";
      }
      if (!input.token && !input.useEnv) {
        return "Bajoseek requires --token <token>";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      return applyBajoseekAccountConfig(cfg, accountId, {
        botId: input.botToken,
        token: input.token,
        tokenFile: input.tokenFile,
        name: input.name,
        wsUrl: input.url,
      });
    },
  },
  messaging: {
    /**
     * 规范化目标地址
     * 支持格式：
     * - bajoseek:user:userId → 私聊
     * - user:userId → 私聊
     * - 纯 userId
     */
    normalizeTarget: (target: string) => {
      const id = target.replace(/^bajoseek:/i, "");

      if (id.startsWith("user:")) {
        return { ok: true, to: `bajoseek:${id}` };
      }

      // 纯 userId（非空字符串）
      if (id && !id.includes(":")) {
        return { ok: true, to: `bajoseek:user:${id}` };
      }

      return { ok: false, error: "无法识别的目标格式" };
    },
    targetResolver: {
      looksLikeId: (id: string): boolean => {
        if (/^bajoseek:user:/i.test(id)) return true;
        if (/^user:/i.test(id)) return true;
        // 简单的 userId 判断
        return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
      },
      hint: "Bajoseek 目标格式: bajoseek:user:userId",
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: chunkText,
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendText({ to, text, accountId, replyToId });
      return {
        channel: "bajoseek" as const,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
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
        onError: (error) => {
          log?.error(`[bajoseek:${account.accountId}] Gateway error: ${error.message}`);
          ctx.setStatus({
            ...ctx.getStatus(),
            lastError: error.message,
          });
        },
      });
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastConnectedAt: null,
      lastError: null,
      lastInboundAt: null,
      lastOutboundAt: null,
    },
    buildChannelSummary: ({ snapshot }: { snapshot: Record<string, unknown> }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      connected: snapshot.connected ?? false,
      lastConnectedAt: snapshot.lastConnectedAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }: { account: ResolvedBajoseekAccount; cfg: OpenClawConfig; runtime?: Record<string, unknown> }) => ({
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
