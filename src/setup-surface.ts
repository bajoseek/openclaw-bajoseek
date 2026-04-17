/**
 * Interactive setup wizard (new OpenClaw 3.24+)
 *
 * Implements `ChannelSetupWizard` using helpers from `openclaw/plugin-sdk/setup`.
 *
 * This file is only loaded dynamically when the new OpenClaw version is detected.
 * It MUST NOT be statically imported — old OpenClaw does not have `openclaw/plugin-sdk/setup`.
 *
 * All user-facing prompts are bilingual: English / Chinese.
 */
import type {OpenClawConfig} from "openclaw/plugin-sdk";

import {DEFAULT_ACCOUNT_ID, listBajoseekAccountIds, resolveBajoseekAccount, testBajoseekConnection} from "./config.js";

const channel = "bajoseek" as const;

/** Default WebSocket endpoint. */
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

/**
 * The setup wizard shown during `openclaw onboard` or initial setup.
 */
export const bajoseekSetupWizard: any = {
  channel,

  status: {
    configuredLabel: "Configured（已配置）",
    unconfiguredLabel: "Requires BotID and Token（需要 BotID 和 Token）",
    configuredHint: "Configured（已配置）",
    unconfiguredHint: "Connect to Bajoseek App via WebSocket（通过 WebSocket 连接 Bajoseek App）",
    configuredScore: 1,
    unconfiguredScore: 20,
    resolveConfigured: ({ cfg }: { cfg: any }) =>
      listBajoseekAccountIds(cfg).some((accountId) => {
        const account = resolveBajoseekAccount(cfg, accountId);
        return Boolean(account.botId && account.token);
      }),
    resolveStatusLines: async ({ configured }: { cfg: any; accountId?: string; configured: boolean }) => [
      `Bajoseek: ${configured ? "Configured（已配置）" : "Requires BotID and Token（需要 BotID 和 Token）"}`,
    ],
  },

  /** Intro note shown when the channel is not yet configured. */
  introNote: {
    title: "Bajoseek Setup（Bajoseek 配置）",
    lines: [
      "1) Create a bot in Bajoseek App to get BotID and Token（在 Bajoseek App 中创建机器人，获取 BotID 和 Token）",
      "2) You can also set environment variables BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN（也可设置环境变量）",
      "",
      `Default WebSocket URL: ${DEFAULT_WS_URL}（默认 WebSocket 地址）`,
      "You can configure a custom URL (e.g. for testing) in the next step（如需自定义地址可在后续步骤配置）",
    ],
    shouldShow: async ({ cfg, accountId }: { cfg: any; accountId: any }) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      return !Boolean(account.botId && account.token);
    },
  },

  /** Shortcut when env vars are detected — skip manual entry. */
  envShortcut: {
    prompt: "Detected BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN in environment. Use them?（检测到环境变量，是否使用？）",
    isAvailable: ({ cfg, accountId }: { cfg: any; accountId: any }) => {
      if (accountId !== DEFAULT_ACCOUNT_ID) return false;
      const envBotId = process.env.BAJOSEEK_BOT_ID?.trim();
      const envToken = process.env.BAJOSEEK_TOKEN?.trim();
      if (!envBotId || !envToken) return false;
      const account = resolveBajoseekAccount(cfg, accountId);
      return !Boolean(account.config.botId && account.config.token);
    },
    apply: ({ cfg, accountId }: { cfg: any; accountId: any }) => {
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

  /** No additional credential steps (handled in `finalize`). */
  credentials: [],

  /**
   * Finalize — the main interactive wizard flow.
   *
   * Steps:
   *   1. BotID  — prompt or use env
   *   2. Token  — prompt or use env
   *   3. WebSocket URL — optional custom
   *   4. Block streaming — enable/disable
   */
  finalize: async ({ cfg, accountId, prompter }: { cfg: any; accountId: any; prompter: any }) => {
    // @ts-ignore — peer dependency, resolved at runtime when OpenClaw invokes the wizard
    const { runSingleChannelSecretStep } = await import("openclaw/plugin-sdk/setup");
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
      applyUseEnv: async (currentCfg: any) => currentCfg,
      applySet: async (currentCfg: any, value: any) =>
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
      applyUseEnv: async (currentCfg: any) => currentCfg,
      applySet: async (currentCfg: any, value: any) =>
        applyTokenToConfig(currentCfg, accountId, String(value).trim()),
    });
    next = tokenStep.cfg;

    // ── Step 3: Optional WebSocket URL ──
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

        // ws:// 安全警告
        if (wsUrl.startsWith("ws://")) {
          await prompter.note(
            "WARNING: Using unencrypted ws:// — credentials will be transmitted in plaintext. Use wss:// in production.（警告：使用了未加密的 ws:// 连接，凭据将以明文传输。生产环境请使用 wss://）",
            "Security Warning（安全警告）",
          );
        }
      }

      // ── Step 4: Block streaming ──
      const blockStreaming = await prompter.confirm({
        message: "Enable block streaming? Long replies will be sent in chunks for better responsiveness（是否开启分块流式回复？开启后长回复将分段发送，提升响应体验）",
        initialValue: true,
      });
      next = applyBlockStreamingToConfig(next, accountId, blockStreaming);
    }

    // ── Step 5: Validate connection ──
    // 校验 botId 和 token 是否能成功连接到 Bajoseek 服务器。
    // 校验失败时允许用户重新输入 BotID 和 Token，循环直到通过或放弃。
    try {
      let finalAccount = resolveBajoseekAccount(next, accountId);
      while (finalAccount.botId && finalAccount.token) {
        await prompter.note(
          "Testing connection to Bajoseek server...（正在测试与 Bajoseek 服务器的连接...）",
          "Bajoseek Validation（凭据校验）",
        );
        const result = await testBajoseekConnection({
          botId: finalAccount.botId,
          token: finalAccount.token,
          wsUrl: finalAccount.wsUrl,
        });

        if (result.ok) {
          await prompter.note(
            "Connection test passed — botId and token are valid（连接测试通过 —— botId 和 token 有效）",
            "Bajoseek Validation（凭据校验）",
          );
          break;
        }

        await prompter.note(
          `Connection test failed: ${result.error}\n（连接测试失败，请检查配置）`,
          "Bajoseek Validation Failed（凭据校验失败）",
        );
        const retry = await prompter.confirm({
          message: "Re-enter BotID and Token? Select 'No' to save config anyway（是否重新输入 BotID 和 Token？选否则保留当前配置）",
          initialValue: true,
        });
        if (!retry) break;

        // Re-enter BotID.
        const newBotId = String(
          await prompter.text({
            message: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
            validate: (v: string) => (v?.trim() ? undefined : "BotID cannot be empty（BotID 不能为空）"),
          }),
        ).trim();
        next = applyBotIdToConfig(next, accountId, newBotId);

        // Re-enter Token.
        const newToken = String(
          await prompter.text({
            message: "Enter Bajoseek Token（请输入 Bajoseek Token）",
            validate: (v: string) => (v?.trim() ? undefined : "Token cannot be empty（Token 不能为空）"),
          }),
        ).trim();
        next = applyTokenToConfig(next, accountId, newToken);

        finalAccount = resolveBajoseekAccount(next, accountId);
      }
    } catch (err) {
      await prompter.note(
        `Connection validation skipped due to error: ${err}（连接校验因异常跳过）`,
        "Warning（警告）",
      );
    }

    return { cfg: next };
  },
};

/* ════════════════════════════════════════════════════════════
 *  Config helpers — immutable config patchers
 *
 *  Each function returns a new OpenClawConfig with the specified
 *  field written into the bajoseek channel section.
 * ════════════════════════════════════════════════════════════ */

/** Write botId into config. */
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

/** Write token into config. */
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

/** Write wsUrl into config. */
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

/** Write blockStreaming into config. */
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
