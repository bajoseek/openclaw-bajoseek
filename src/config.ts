import type { ResolvedBajoseekAccount, BajoseekAccountConfig } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import * as fs from "node:fs";

export const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

interface BajoseekChannelConfig extends BajoseekAccountConfig {
  accounts?: Record<string, BajoseekAccountConfig>;
}

/**
 * 列出所有 Bajoseek 账户 ID
 */
export function listBajoseekAccountIds(cfg: OpenClawConfig): string[] {
  const ids = new Set<string>();
  const bajoseek = cfg.channels?.bajoseek as BajoseekChannelConfig | undefined;

  if (bajoseek?.botId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  if (bajoseek?.accounts) {
    for (const accountId of Object.keys(bajoseek.accounts)) {
      if (bajoseek.accounts[accountId]?.botId) {
        ids.add(accountId);
      }
    }
  }

  return Array.from(ids);
}

/**
 * 获取默认账户 ID
 */
export function resolveDefaultBajoseekAccountId(cfg: OpenClawConfig): string {
  const bajoseek = cfg.channels?.bajoseek as BajoseekChannelConfig | undefined;
  if (bajoseek?.botId) {
    return DEFAULT_ACCOUNT_ID;
  }
  if (bajoseek?.accounts) {
    const ids = Object.keys(bajoseek.accounts);
    if (ids.length > 0) {
      return ids[0];
    }
  }
  return DEFAULT_ACCOUNT_ID;
}

/**
 * 解析 Bajoseek 账户配置
 * 支持三级回退：config → file → env
 */
export function resolveBajoseekAccount(
  cfg: OpenClawConfig,
  accountId?: string | null
): ResolvedBajoseekAccount {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
  const bajoseek = cfg.channels?.bajoseek as BajoseekChannelConfig | undefined;

  let accountConfig: BajoseekAccountConfig = {};
  let botId = "";
  let token = "";
  let tokenSource: "config" | "file" | "env" | "none" = "none";

  if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    accountConfig = {
      enabled: bajoseek?.enabled,
      name: bajoseek?.name,
      botId: bajoseek?.botId,
      token: bajoseek?.token,
      tokenFile: bajoseek?.tokenFile,
      wsUrl: bajoseek?.wsUrl,
      allowFrom: bajoseek?.allowFrom,
      blockStreaming: (bajoseek as Record<string, unknown>)?.blockStreaming as boolean | undefined,
    };
    botId = (bajoseek?.botId ?? "").trim();
  } else {
    const account = bajoseek?.accounts?.[resolvedAccountId];
    accountConfig = account ?? {};
    botId = (account?.botId ?? "").trim();
  }

  // 解析 token：config → file → env
  if (accountConfig.token) {
    token = accountConfig.token;
    tokenSource = "config";
  } else if (accountConfig.tokenFile) {
    try {
      token = fs.readFileSync(accountConfig.tokenFile, "utf-8").trim();
      tokenSource = "file";
    } catch {
      // file read failed, fall through
    }
  } else if (process.env.BAJOSEEK_TOKEN && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    token = process.env.BAJOSEEK_TOKEN;
    tokenSource = "env";
  }

  // botId 也可以从环境变量读取
  if (!botId && process.env.BAJOSEEK_BOT_ID && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    botId = process.env.BAJOSEEK_BOT_ID.trim();
  }

  // wsUrl：account config → channel config → default
  const wsUrl = accountConfig.wsUrl || bajoseek?.wsUrl || DEFAULT_WS_URL;

  return {
    accountId: resolvedAccountId,
    name: accountConfig.name,
    enabled: accountConfig.enabled !== false,
    botId,
    token,
    tokenSource,
    wsUrl,
    config: accountConfig,
  };
}

/**
 * 应用账户配置
 */
export function applyBajoseekAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: { botId?: string; token?: string; tokenFile?: string; name?: string; wsUrl?: string }
): OpenClawConfig {
  const next = { ...cfg };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const existingConfig = (next.channels?.bajoseek as BajoseekChannelConfig) || {};
    const allowFrom = existingConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      bajoseek: {
        ...(next.channels?.bajoseek as Record<string, unknown> || {}),
        enabled: true,
        blockStreaming: true,
        allowFrom,
        ...(input.botId ? { botId: input.botId } : {}),
        ...(input.token
          ? { token: input.token }
          : input.tokenFile
            ? { tokenFile: input.tokenFile }
            : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
      },
    };
  } else {
    const existingAccountConfig = (next.channels?.bajoseek as BajoseekChannelConfig)?.accounts?.[accountId] || {};
    const allowFrom = existingAccountConfig.allowFrom ?? ["*"];

    next.channels = {
      ...next.channels,
      bajoseek: {
        ...(next.channels?.bajoseek as Record<string, unknown> || {}),
        enabled: true,
        accounts: {
          ...((next.channels?.bajoseek as BajoseekChannelConfig)?.accounts || {}),
          [accountId]: {
            ...((next.channels?.bajoseek as BajoseekChannelConfig)?.accounts?.[accountId] || {}),
            enabled: true,
            blockStreaming: true,
            allowFrom,
            ...(input.botId ? { botId: input.botId } : {}),
            ...(input.token
              ? { token: input.token }
              : input.tokenFile
                ? { tokenFile: input.tokenFile }
                : {}),
            ...(input.name ? { name: input.name } : {}),
            ...(input.wsUrl ? { wsUrl: input.wsUrl } : {}),
          },
        },
      },
    };
  }

  return next;
}
