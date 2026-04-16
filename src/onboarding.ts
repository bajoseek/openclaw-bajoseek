/**
 * Legacy onboarding adapter
 *
 * Implements `ChannelOnboardingAdapter` for old OpenClaw (3.13).
 *
 * This file is loaded dynamically (`await import()`) only when the old-version
 * API is detected. It intentionally avoids importing from `openclaw/plugin-sdk/setup`
 * (which does not exist in old versions).
 *
 * All user-facing prompts are bilingual: English / Chinese.
 *
 * The adapter is typed as `any` to avoid depending on the old-version-only
 * `ChannelOnboardingAdapter` type at compile time.
 */
import type {OpenClawConfig} from "openclaw/plugin-sdk";
import {DEFAULT_ACCOUNT_ID, listBajoseekAccountIds, resolveBajoseekAccount, testBajoseekConnection} from "./config.js";

const channel = "bajoseek" as const;

/** Default WebSocket endpoint. */
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

export const bajoseekOnboardingAdapter: any = {
  channel,

  /**
   * Report whether the channel is configured.
   *
   * Returns status lines and a quickstart score used by the OpenClaw onboarding UI.
   */
  getStatus: async ({ cfg }: { cfg: OpenClawConfig }) => {
    const configured = listBajoseekAccountIds(cfg).some((accountId) => {
      const account = resolveBajoseekAccount(cfg, accountId);
      return Boolean(account.botId && account.token);
    });
    return {
      channel,
      configured,
      statusLines: [
        `Bajoseek: ${configured ? "Configured（已配置）" : "Requires BotID and Token（需要 BotID 和 Token）"}`,
      ],
      selectionHint: configured
        ? "Configured（已配置）"
        : "Connect to Bajoseek App via WebSocket（通过 WebSocket 连接 Bajoseek App）",
      quickstartScore: configured ? 1 : 20,
    };
  },

  /**
   * Interactive configuration wizard.
   *
   * Guides the user through 4 steps:
   *   1. BotID  — enter or use env var
   *   2. Token  — enter or use env var
   *   3. WebSocket URL — optional custom URL
   *   4. Block streaming — enable/disable chunked replies
   */
  configure: async ({
    cfg,
    prompter,
  }: {
    cfg: OpenClawConfig;
    runtime: any;
    prompter: any;
    options?: any;
    accountOverrides: any;
    shouldPromptAccountIds: boolean;
    forceAllowFrom: boolean;
  }) => {
    let next = cfg;
    const accountId = DEFAULT_ACCOUNT_ID;
    const resolved = resolveBajoseekAccount(next, accountId);
    const hasBotId = Boolean(resolved.config.botId);
    const hasToken = Boolean(resolved.config.token || resolved.config.tokenFile);

    // ── Intro note ──
    if (!hasBotId || !hasToken) {
      await prompter.note(
        [
          "1) Create a bot in Bajoseek App to get BotID and Token（在 Bajoseek App 中创建机器人，获取 BotID 和 Token）",
          "2) You can also set environment variables BAJOSEEK_BOT_ID and BAJOSEEK_TOKEN（也可设置环境变量）",
          "",
          `Default WebSocket URL: ${DEFAULT_WS_URL}（默认 WebSocket 地址）`,
        ].join("\n"),
        "Bajoseek Setup（Bajoseek 配置）",
      );
    }

    // ── Step 1: BotID ──
    const envBotId = process.env.BAJOSEEK_BOT_ID?.trim();
    if (envBotId && !hasBotId) {
      // Env var detected, offer to use it.
      const useEnv = await prompter.confirm({
        message: "BAJOSEEK_BOT_ID detected. Use env var?（检测到 BAJOSEEK_BOT_ID 环境变量，是否使用？）",
        initialValue: true,
      });
      if (!useEnv) {
        const botId = String(
          await prompter.text({
            message: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
            validate: (v: string) => (v?.trim() ? undefined : "BotID cannot be empty（BotID 不能为空）"),
          }),
        ).trim();
        next = applyBotIdToConfig(next, accountId, botId);
      }
    } else if (hasBotId) {
      // Already configured, offer to keep.
      const keep = await prompter.confirm({
        message: "Bajoseek BotID already configured. Keep it?（BotID 已配置，是否保留？）",
        initialValue: true,
      });
      if (!keep) {
        const botId = String(
          await prompter.text({
            message: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
            validate: (v: string) => (v?.trim() ? undefined : "BotID cannot be empty（BotID 不能为空）"),
          }),
        ).trim();
        next = applyBotIdToConfig(next, accountId, botId);
      }
    } else {
      // No existing value — prompt for input.
      const botId = String(
        await prompter.text({
          message: "Enter Bajoseek BotID（请输入 Bajoseek BotID）",
          validate: (v: string) => (v?.trim() ? undefined : "BotID cannot be empty（BotID 不能为空）"),
        }),
      ).trim();
      next = applyBotIdToConfig(next, accountId, botId);
    }

    // ── Step 2: Token ──
    const envToken = process.env.BAJOSEEK_TOKEN?.trim();
    if (envToken && !hasToken) {
      const useEnv = await prompter.confirm({
        message: "BAJOSEEK_TOKEN detected. Use env var?（检测到 BAJOSEEK_TOKEN 环境变量，是否使用？）",
        initialValue: true,
      });
      if (!useEnv) {
        const token = String(
          await prompter.text({
            message: "Enter Bajoseek Token（请输入 Bajoseek Token）",
            validate: (v: string) => (v?.trim() ? undefined : "Token cannot be empty（Token 不能为空）"),
          }),
        ).trim();
        next = applyTokenToConfig(next, accountId, token);
      }
    } else if (hasToken) {
      const keep = await prompter.confirm({
        message: "Bajoseek token already configured. Keep it?（Token 已配置，是否保留？）",
        initialValue: true,
      });
      if (!keep) {
        const token = String(
          await prompter.text({
            message: "Enter Bajoseek Token（请输入 Bajoseek Token）",
            validate: (v: string) => (v?.trim() ? undefined : "Token cannot be empty（Token 不能为空）"),
          }),
        ).trim();
        next = applyTokenToConfig(next, accountId, token);
      }
    } else {
      const token = String(
        await prompter.text({
          message: "Enter Bajoseek Token（请输入 Bajoseek Token）",
          validate: (v: string) => (v?.trim() ? undefined : "Token cannot be empty（Token 不能为空）"),
        }),
      ).trim();
      next = applyTokenToConfig(next, accountId, token);
    }

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

    return { cfg: next, accountId };
  },

  /**
   * Disable the Bajoseek channel.
   */
  disable: (cfg: OpenClawConfig) => {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        bajoseek: {
          ...(cfg.channels?.bajoseek as Record<string, unknown>),
          enabled: false,
        },
      },
    } as OpenClawConfig;
  },
};

/* ════════════════════════════════════════════════════════════
 *  Config helpers — shared with setup-surface.ts
 *
 *  Each function returns a new OpenClawConfig with the specified
 *  field patched into the bajoseek channel section.
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
