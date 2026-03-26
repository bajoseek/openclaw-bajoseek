/**
 * Interactive setup wizard — 交互式配置向导 (new OpenClaw 3.24+)
 *
 * Implements `ChannelSetupWizard` using helpers from `openclaw/plugin-sdk/setup`.
 * 使用 `openclaw/plugin-sdk/setup` 的辅助函数实现 `ChannelSetupWizard`。
 *
 * This file is only loaded dynamically when the new OpenClaw version is detected.
 * It MUST NOT be statically imported — old OpenClaw does not have `openclaw/plugin-sdk/setup`.
 * 此文件仅在检测到新版 OpenClaw 时通过动态 import 加载。
 * 绝不能静态导入——旧版 OpenClaw 不存在 `openclaw/plugin-sdk/setup`。
 *
 * All user-facing prompts are bilingual: English（中文）.
 * 所有面向用户的提示文本均为双语：English（中文）。
 */
import {
  createStandardChannelSetupStatus,
  DEFAULT_ACCOUNT_ID,
  mergeAllowFromEntries,
  runSingleChannelSecretStep,
  type ChannelSetupWizard,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/setup";
import {
  listBajoseekAccountIds,
  resolveBajoseekAccount,
} from "./config.js";

const channel = "bajoseek" as const;

/** Default WebSocket endpoint. / 默认 WebSocket 端点。 */
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

/**
 * The setup wizard shown during `openclaw onboard` or initial setup.
 * `openclaw onboard` 或初始配置时展示的配置向导。
 */
export const bajoseekSetupWizard: ChannelSetupWizard = {
  channel,

  /** Status check — determines "configured" vs "needs setup" in the UI. / 状态检查——在 UI 中区分"已配置"和"需要配置"。 */
  status: createStandardChannelSetupStatus({
    channelLabel: "Bajoseek",
    configuredLabel: "Configured（已配置）",
    unconfiguredLabel: "Requires BotID and Token（需要 BotID 和 Token）",
    configuredHint: "Configured（已配置）",
    unconfiguredHint: "Connect to Bajoseek App via WebSocket（通过 WebSocket 连接 Bajoseek App）",
    configuredScore: 1,
    unconfiguredScore: 20,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) =>
      listBajoseekAccountIds(cfg).some((accountId) => {
        const account = resolveBajoseekAccount(cfg, accountId);
        return Boolean(account.botId && account.token);
      }),
  }),

  /** Intro note shown when the channel is not yet configured. / 频道未配置时显示的介绍信息。 */
  introNote: {
    title: "Bajoseek Setup（Bajoseek 配置）",
    lines: [
      "1) Create a bot in Bajoseek App to get BotID and Token（在 Bajoseek App 中创建机器人，获取 BotID 和 Token）",
      "2) You can also set environment variables BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN（也可设置环境变量）",
      "",
      `Default WebSocket URL: ${DEFAULT_WS_URL}（默认 WebSocket 地址）`,
      "You can configure a custom URL (e.g. for testing) in the next step（如需自定义地址可在后续步骤配置）",
    ],
    shouldShow: async ({ cfg, accountId }) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      return !Boolean(account.botId && account.token);
    },
  },

  /** Shortcut when env vars are detected — skip manual entry. / 检测到环境变量时的快捷方式——跳过手动输入。 */
  envShortcut: {
    prompt: "Detected BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN in environment. Use them?（检测到环境变量，是否使用？）",
    isAvailable: ({ cfg, accountId }) => {
      if (accountId !== DEFAULT_ACCOUNT_ID) return false;
      const envBotId = process.env.BAJOSEEK_BOT_ID?.trim();
      const envToken = process.env.BAJOSEEK_TOKEN?.trim();
      if (!envBotId || !envToken) return false;
      const account = resolveBajoseekAccount(cfg, accountId);
      return !Boolean(account.config.botId && account.config.token);
    },
    apply: ({ cfg, accountId }) => {
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          bajoseek: {
            ...cfg.channels?.bajoseek,
            enabled: true,
            blockStreaming: true,
            allowFrom: (cfg.channels?.bajoseek as Record<string, unknown>)?.allowFrom ?? ["*"],
          },
        },
      } as OpenClawConfig;
    },
  },

  /** No additional credential steps (handled in `finalize`). / 无额外凭证步骤（在 finalize 中处理）。 */
  credentials: [],

  /**
   * Finalize — the main interactive wizard flow.
   * Finalize——主交互式向导流程。
   *
   * Steps / 步骤:
   *   1. BotID  — prompt or use env / 输入或使用环境变量
   *   2. Token  — prompt or use env / 输入或使用环境变量
   *   3. WebSocket URL — optional custom / 可选自定义
   *   4. Block streaming — enable/disable / 启用/禁用
   */
  finalize: async ({ cfg, accountId, prompter }) => {
    let next = cfg;
    const resolvedAccount = resolveBajoseekAccount(next, accountId);
    const hasConfigBotId = Boolean(resolvedAccount.config.botId);
    const hasConfigToken = Boolean(resolvedAccount.config.token || resolvedAccount.config.tokenFile);

    // ── Step 1: BotID ──
    const botIdStep = await runSingleChannelSecretStep({
      cfg: next,
      prompter,
      providerHint: "bajoseek",
      credentialLabel: "BotID",
      accountConfigured: hasConfigBotId,
      hasConfigToken: hasConfigBotId,
      allowEnv: accountId === DEFAULT_ACCOUNT_ID,
      envValue: process.env.BAJOSEEK_BOT_ID,
      envPrompt: "BAJOSEEK_BOT_ID detected. Use env var?（检测到 BAJOSEEK_BOT_ID 环境变量，是否使用？）",
      keepPrompt: "Bajoseek BotID already configured. Keep it?（BotID 已配置，是否保留？）",
      inputPrompt: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
      preferredEnvVar: "BAJOSEEK_BOT_ID",
      applyUseEnv: async (currentCfg) => currentCfg,
      applySet: async (currentCfg, value) =>
        applyBotIdToConfig(currentCfg, accountId, String(value).trim()),
    });
    next = botIdStep.cfg;

    // ── Step 2: Token ──
    const tokenStep = await runSingleChannelSecretStep({
      cfg: next,
      prompter,
      providerHint: "bajoseek",
      credentialLabel: "token",
      accountConfigured: hasConfigToken,
      hasConfigToken,
      allowEnv: accountId === DEFAULT_ACCOUNT_ID,
      envValue: process.env.BAJOSEEK_TOKEN,
      envPrompt: "BAJOSEEK_TOKEN detected. Use env var?（检测到 BAJOSEEK_TOKEN 环境变量，是否使用？）",
      keepPrompt: "Bajoseek token already configured. Keep it?（Token 已配置，是否保留？）",
      inputPrompt: "Enter Bajoseek Token（请输入 Bajoseek Token）",
      preferredEnvVar: "BAJOSEEK_TOKEN",
      applyUseEnv: async (currentCfg) => currentCfg,
      applySet: async (currentCfg, value) =>
        applyTokenToConfig(currentCfg, accountId, String(value).trim()),
    });
    next = tokenStep.cfg;

    // ── Step 3: Optional WebSocket URL / 可选 WebSocket 地址 ──
    const currentBotId = resolveBajoseekAccount(next, accountId).botId;
    const currentToken = resolveBajoseekAccount(next, accountId).token;
    if (currentBotId && currentToken) {
      const useCustomUrl = await prompter.confirm({
        message: `Modify WebSocket URL? Select 'No' to use default: ${DEFAULT_WS_URL}（是否修改 WebSocket 地址？选否使用默认地址）`,
        initialValue: false,
      });
      if (useCustomUrl) {
        const wsUrl = String(
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
        next = applyWsUrlToConfig(next, accountId, wsUrl);
      }

      // ── Step 4: Block streaming / 分块流式回复 ──
      const blockStreaming = await prompter.confirm({
        message: "Enable block streaming? Long replies will be sent in chunks for better responsiveness（是否开启分块流式回复？开启后长回复将分段发送，提升响应体验）",
        initialValue: true,
      });
      next = applyBlockStreamingToConfig(next, accountId, blockStreaming);
    }

    return { cfg: next };
  },
};

/* ════════════════════════════════════════════════════════════
 *  Config helpers — immutable config patchers
 *  配置辅助函数——不可变配置修补器
 *
 *  Each function returns a new OpenClawConfig with the specified
 *  field written into the bajoseek channel section.
 *  每个函数返回新的 OpenClawConfig，将指定字段写入 bajoseek 频道区段。
 * ════════════════════════════════════════════════════════════ */

/** Write botId into config. / 将 botId 写入配置。 */
function applyBotIdToConfig(cfg: OpenClawConfig, accountId: string, botId: string): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: { ...cfg.channels?.bajoseek, enabled: true, botId },
      },
    } as OpenClawConfig;
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      bajoseek: {
        ...cfg.channels?.bajoseek,
        enabled: true,
        accounts: {
          ...(cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>,
          [accountId]: {
            ...((cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>)?.[accountId] as Record<string, unknown>,
            enabled: true,
            botId,
          },
        },
      },
    },
  } as OpenClawConfig;
}

/** Write token into config. / 将 token 写入配置。 */
function applyTokenToConfig(cfg: OpenClawConfig, accountId: string, token: string): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: { ...cfg.channels?.bajoseek, enabled: true, token },
      },
    } as OpenClawConfig;
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      bajoseek: {
        ...cfg.channels?.bajoseek,
        enabled: true,
        accounts: {
          ...(cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>,
          [accountId]: {
            ...((cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>)?.[accountId] as Record<string, unknown>,
            enabled: true,
            token,
          },
        },
      },
    },
  } as OpenClawConfig;
}

/** Write wsUrl into config. / 将 wsUrl 写入配置。 */
function applyWsUrlToConfig(cfg: OpenClawConfig, accountId: string, wsUrl: string): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: { ...cfg.channels?.bajoseek, wsUrl },
      },
    } as OpenClawConfig;
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      bajoseek: {
        ...cfg.channels?.bajoseek,
        accounts: {
          ...(cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>,
          [accountId]: {
            ...((cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>)?.[accountId] as Record<string, unknown>,
            wsUrl,
          },
        },
      },
    },
  } as OpenClawConfig;
}

/** Write blockStreaming into config. / 将 blockStreaming 写入配置。 */
function applyBlockStreamingToConfig(cfg: OpenClawConfig, accountId: string, blockStreaming: boolean): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: { ...cfg.channels?.bajoseek, blockStreaming },
      },
    } as OpenClawConfig;
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      bajoseek: {
        ...cfg.channels?.bajoseek,
        accounts: {
          ...(cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>,
          [accountId]: {
            ...((cfg.channels?.bajoseek as Record<string, unknown>)?.accounts as Record<string, unknown>)?.[accountId] as Record<string, unknown>,
            blockStreaming,
          },
        },
      },
    },
  } as OpenClawConfig;
}
