/**
 * Bajoseek CLI Onboarding Adapter
 *
 * 提供 openclaw onboard 命令的交互式配置支持，
 * 引导用户输入 botId、token 和可选的 wsUrl。
 */
import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingStatus,
  ChannelOnboardingStatusContext,
  ChannelOnboardingConfigureContext,
  ChannelOnboardingResult,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";

import {
  DEFAULT_ACCOUNT_ID,
  listBajoseekAccountIds,
  resolveBajoseekAccount,
} from "./config.js";

import type { BajoseekAccountConfig } from "./types.js";

interface BajoseekChannelConfig extends BajoseekAccountConfig {
  accounts?: Record<string, BajoseekAccountConfig>;
}

/**
 * 解析默认账户 ID
 */
function resolveDefaultAccountId(cfg: OpenClawConfig): string {
  const ids = listBajoseekAccountIds(cfg);
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

/**
 * Bajoseek Onboarding Adapter
 */
export const bajoseekOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: "bajoseek" as any,

  /**
   * 获取当前 Bajoseek 配置状态
   */
  getStatus: async (ctx: ChannelOnboardingStatusContext): Promise<ChannelOnboardingStatus> => {
    const cfg = ctx.cfg;
    const configured = listBajoseekAccountIds(cfg).some((accountId) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      return Boolean(account.botId && account.token);
    });

    return {
      channel: "bajoseek" as any,
      configured,
      statusLines: [`Bajoseek: ${configured ? "Configured（已配置）" : "Requires BotID and Token（需要 BotID 和 Token）"}`],
      selectionHint: configured ? "Configured（已配置）" : "Connect to Bajoseek App via WebSocket（通过 WebSocket 连接 Bajoseek App）",
      quickstartScore: configured ? 1 : 20,
    };
  },

  /**
   * 交互式配置 Bajoseek
   */
  configure: async (ctx: ChannelOnboardingConfigureContext): Promise<ChannelOnboardingResult> => {
    const cfg = ctx.cfg;
    const prompter = ctx.prompter;
    const accountOverrides = ctx.accountOverrides as Record<string, string> | undefined;
    const shouldPromptAccountIds = ctx.shouldPromptAccountIds;

    const bajoseekOverride = accountOverrides?.bajoseek?.trim();
    const defaultAccountId = resolveDefaultAccountId(cfg);
    let accountId = bajoseekOverride ?? defaultAccountId;

    // 多账户时提示选择
    if (shouldPromptAccountIds && !bajoseekOverride) {
      const existingIds = listBajoseekAccountIds(cfg);
      if (existingIds.length > 1) {
        accountId = await prompter.select({
          message: "Select Bajoseek account（选择 Bajoseek 账户）",
          options: existingIds.map((id) => ({
            value: id,
            label: id === DEFAULT_ACCOUNT_ID ? "Default account（默认账户）" : id,
          })),
          initialValue: accountId,
        });
      }
    }

    let next: OpenClawConfig = cfg;
    const resolvedAccount = resolveBajoseekAccount(next, accountId);
    const accountConfigured = Boolean(resolvedAccount.botId && resolvedAccount.token);
    const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
    const envBotId = typeof process !== "undefined" ? process.env?.BAJOSEEK_BOT_ID?.trim() : undefined;
    const envToken = typeof process !== "undefined" ? process.env?.BAJOSEEK_TOKEN?.trim() : undefined;
    const canUseEnv = allowEnv && Boolean(envBotId && envToken);
    const hasConfigCredentials = Boolean(resolvedAccount.config.botId && resolvedAccount.config.token);

    let botId: string | null = null;
    let token: string | null = null;
    let wsUrl: string | null = null;

    // 显示帮助信息
    if (!accountConfigured) {
      await prompter.note(
        [
          "1) Create a bot in Bajoseek App to get BotID and Token（在 Bajoseek App 中创建机器人，获取 BotID 和 Token）",
          "2) You can also set environment variables BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN（也可设置环境变量）",
          "",
          "Default WebSocket URL: wss://ws.bajoseek.com（默认 WebSocket 地址）",
          "You can configure a custom URL (e.g. for testing) in the next step（如需自定义地址可在后续步骤配置）",
        ].join("\n"),
        "Bajoseek Setup（Bajoseek 配置）",
      );
    }

    // 检测环境变量
    if (canUseEnv && !hasConfigCredentials) {
      const keepEnv = await prompter.confirm({
        message: "Detected BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN in environment. Use them?（检测到环境变量，是否使用？）",
        initialValue: true,
      });
      if (keepEnv) {
        next = applyConfig(next, accountId, resolvedAccount, {});
      } else {
        ({ botId, token } = await promptCredentials(prompter, resolvedAccount));
      }
    } else if (hasConfigCredentials) {
      // 已有配置
      const keep = await prompter.confirm({
        message: "Bajoseek is already configured. Keep current settings?（已配置，是否保留当前配置？）",
        initialValue: true,
      });
      if (!keep) {
        ({ botId, token } = await promptCredentials(prompter, resolvedAccount));
      }
    } else {
      // 没有配置，需要输入
      ({ botId, token } = await promptCredentials(prompter, resolvedAccount));
    }

    // 可选：自定义 WebSocket URL
    let blockStreaming = true;
    if (botId && token) {
      const useCustomUrl = await prompter.confirm({
        message: "Modify WebSocket URL? Select 'No' to use default: wss://ws.bajoseek.com（是否修改 WebSocket 地址？选否使用默认地址）",
        initialValue: false,
      });
      if (useCustomUrl) {
        wsUrl = String(
          await prompter.text({
            message: "Enter WebSocket URL（请输入 WebSocket 地址）",
            placeholder: "e.g. ws://localhost:9093/ws/bot",
            initialValue: resolvedAccount.config.wsUrl || undefined,
            validate: (value: string) => {
              if (!value?.trim()) return "WebSocket URL cannot be empty（地址不能为空）";
              if (!value.startsWith("ws://") && !value.startsWith("wss://"))
                return "URL must start with ws:// or wss://（地址必须以 ws:// 或 wss:// 开头）";
              return undefined;
            },
          }),
        ).trim();
      }

      // 可选：开启分块流式回复
      blockStreaming = await prompter.confirm({
        message: "Enable block streaming? Long replies will be sent in chunks for better responsiveness（是否开启分块流式回复？开启后长回复将分段发送，提升响应体验）",
        initialValue: true,
      });
    }

    // 应用配置
    if (botId && token) {
      next = applyConfig(next, accountId, resolvedAccount, { botId, token, wsUrl, blockStreaming });
    }

    return { cfg: next as any, accountId };
  },

  /**
   * 禁用 Bajoseek 频道
   */
  disable: (cfg: unknown) => {
    const config = cfg as OpenClawConfig;
    return {
      ...config,
      channels: {
        ...config.channels,
        bajoseek: { ...(config.channels?.bajoseek as Record<string, unknown> || {}), enabled: false },
      },
    } as any;
  },
};

/**
 * 交互式提示输入 BotID 和 Token
 */
async function promptCredentials(
  prompter: WizardPrompter,
  resolvedAccount: { botId: string; config: BajoseekAccountConfig },
): Promise<{ botId: string; token: string }> {
  const botId = String(
    await prompter.text({
      message: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
      placeholder: "e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      initialValue: resolvedAccount.botId || undefined,
      validate: (value: string) => (value?.trim() ? undefined : "BotID cannot be empty（BotID 不能为空）"),
    }),
  ).trim();

  const token = String(
    await prompter.text({
      message: "Enter Bajoseek Token（请输入 Bajoseek Token）",
      placeholder: "Your Bot Token",
      validate: (value: string) => (value?.trim() ? undefined : "Token cannot be empty（Token 不能为空）"),
    }),
  ).trim();

  return { botId, token };
}

/**
 * 将凭证和 URL 应用到配置
 */
function applyConfig(
  cfg: OpenClawConfig,
  accountId: string,
  resolvedAccount: { config: BajoseekAccountConfig },
  input: { botId?: string | null; token?: string | null; wsUrl?: string | null; blockStreaming?: boolean },
): OpenClawConfig {
  const allowFrom: string[] = resolvedAccount.config?.allowFrom ?? ["*"];
  const blockStreaming = input.blockStreaming ?? true;

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const existing = (cfg.channels?.bajoseek as Record<string, unknown>) || {};
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: {
          ...existing,
          enabled: true,
          blockStreaming,
          allowFrom,
          ...(input.botId ? { botId: input.botId } : {}),
          ...(input.token ? { token: input.token } : {}),
          ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
        },
      },
    };
  }

  const existingChannel = (cfg.channels?.bajoseek as BajoseekChannelConfig) || {};
  const existingAccounts = existingChannel.accounts || {};
  const existingAccount = existingAccounts[accountId] || {};

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      bajoseek: {
        ...(cfg.channels?.bajoseek as Record<string, unknown> || {}),
        enabled: true,
        accounts: {
          ...existingAccounts,
          [accountId]: {
            ...existingAccount,
            enabled: true,
            blockStreaming,
            allowFrom,
            ...(input.botId ? { botId: input.botId } : {}),
            ...(input.token ? { token: input.token } : {}),
            ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
          },
        },
      },
    },
  };
}
