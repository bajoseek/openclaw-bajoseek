/**
 * Account config resolution — 账户配置解析
 *
 * Reads, lists, and applies Bajoseek account configuration from the OpenClaw config tree.
 * 从 OpenClaw 配置树中读取、列举和应用 Bajoseek 账户配置。
 *
 * Token resolution follows a 3-level fallback:
 * Token 解析遵循三级回退：
 *   1. `token` field in config — 配置文件中的 token 字段
 *   2. `tokenFile` (read from disk) — tokenFile（从磁盘读取）
 *   3. `BAJOSEEK_TOKEN` env var (default account only) — 环境变量（仅默认账户）
 */
import type { ResolvedBajoseekAccount, BajoseekAccountConfig } from "./types.js";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import * as fs from "node:fs";

/** Sentinel account ID for the top-level (non-sub-account) config. / 顶层配置（非子账户）的标识。 */
export const DEFAULT_ACCOUNT_ID = "default";

/** Default WebSocket endpoint. / 默认 WebSocket 端点。 */
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

/** Extended channel config that includes the `accounts` map. / 包含 accounts 映射的扩展频道配置。 */
interface BajoseekChannelConfig extends BajoseekAccountConfig {
  accounts?: Record<string, BajoseekAccountConfig>;
}

/**
 * List all configured Bajoseek account IDs.
 * 列出所有已配置的 Bajoseek 账户 ID。
 *
 * An account is considered "configured" if it has a non-empty `botId`.
 * 只有 `botId` 非空的账户才被视为"已配置"。
 */
export function listBajoseekAccountIds(cfg: OpenClawConfig): string[] {
  const ids = new Set<string>();
  const bajoseek = cfg.channels?.bajoseek as BajoseekChannelConfig | undefined;

  // Top-level account / 顶层账户
  if (bajoseek?.botId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  // Sub-accounts / 子账户
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
 * Determine the default account ID (first available).
 * 确定默认账户 ID（取首个可用账户）。
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
 * Resolve a Bajoseek account into its runtime representation.
 * 将 Bajoseek 账户解析为运行时表示。
 *
 * Token resolution order: config.token → config.tokenFile → env BAJOSEEK_TOKEN.
 * Token 解析顺序：config.token → config.tokenFile → 环境变量 BAJOSEEK_TOKEN。
 *
 * BotId also falls back to env BAJOSEEK_BOT_ID for the default account.
 * 默认账户的 BotId 也会回退到环境变量 BAJOSEEK_BOT_ID。
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
    // Read from top-level channel section. / 从顶层频道区段读取。
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
    // Read from sub-account. / 从子账户读取。
    const account = bajoseek?.accounts?.[resolvedAccountId];
    accountConfig = account ?? {};
    botId = (account?.botId ?? "").trim();
  }

  // Resolve token: config → file → env.
  // 解析 Token：配置 → 文件 → 环境变量。
  if (accountConfig.token) {
    token = accountConfig.token;
    tokenSource = "config";
  } else if (accountConfig.tokenFile) {
    try {
      token = fs.readFileSync(accountConfig.tokenFile, "utf-8").trim();
      tokenSource = "file";
    } catch {
      // File read failed — fall through. / 文件读取失败——继续回退。
    }
  } else if (process.env.BAJOSEEK_TOKEN && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    token = process.env.BAJOSEEK_TOKEN;
    tokenSource = "env";
  }

  // BotId env fallback (default account only). / BotId 环境变量回退（仅默认账户）。
  if (!botId && process.env.BAJOSEEK_BOT_ID && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    botId = process.env.BAJOSEEK_BOT_ID.trim();
  }

  // WebSocket URL: account → channel → default.
  // WebSocket 地址：账户配置 → 频道配置 → 默认值。
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
 * Apply account config from CLI input (non-interactive setup).
 * 从 CLI 输入应用账户配置（非交互式 setup）。
 *
 * Merges the input fields into the existing config, preserving unspecified values.
 * 将输入字段合并到现有配置中，保留未指定的值。
 */
export function applyBajoseekAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: { botId?: string; token?: string; tokenFile?: string; name?: string; wsUrl?: string }
): OpenClawConfig {
  const next = { ...cfg };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    // Patch top-level section. / 修补顶层区段。
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
    // Patch sub-account. / 修补子账户。
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
