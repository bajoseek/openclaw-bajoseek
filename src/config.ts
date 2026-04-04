/**
 * Account config resolution
 *
 * Reads, lists, and applies Bajoseek account configuration from the OpenClaw config tree.
 *
 * Token resolution follows a 3-level fallback:
 *   1. `token` field in config
 *   2. `tokenFile` (read from disk)
 *   3. `BAJOSEEK_TOKEN` env var (default account only)
 */
import type {BajoseekAccountConfig, ResolvedBajoseekAccount} from "./types.js";
import type {OpenClawConfig} from "openclaw/plugin-sdk";
import * as fs from "node:fs";

/** Sentinel account ID for the top-level (non-sub-account) config. */
export const DEFAULT_ACCOUNT_ID = "default";

/** Default WebSocket endpoint. */
const DEFAULT_WS_URL = "wss://ws.bajoseek.com";

/** Extended channel config that includes the `accounts` map. */
interface BajoseekChannelConfig extends BajoseekAccountConfig {
  accounts?: Record<string, BajoseekAccountConfig>;
}

/**
 * List all configured Bajoseek account IDs.
 *
 * An account is considered "configured" if it has a non-empty `botId`.
 */
export function listBajoseekAccountIds(cfg: OpenClawConfig): string[] {
  const ids = new Set<string>();
  const bajoseek = cfg.channels?.bajoseek as BajoseekChannelConfig | undefined;

  // Top-level account
  if (bajoseek?.botId) {
    ids.add(DEFAULT_ACCOUNT_ID);
  }

  // Sub-accounts
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
 *
 * Token resolution order: config.token → config.tokenFile → env BAJOSEEK_TOKEN.
 *
 * BotId also falls back to env BAJOSEEK_BOT_ID for the default account.
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
    // Read from top-level channel section.
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
    // Read from sub-account.
    const account = bajoseek?.accounts?.[resolvedAccountId];
    accountConfig = account ?? {};
    botId = (account?.botId ?? "").trim();
  }

  // Resolve token: config → file → env.
  if (accountConfig.token) {
    token = accountConfig.token;
    tokenSource = "config";
  } else if (accountConfig.tokenFile) {
    try {
      token = fs.readFileSync(accountConfig.tokenFile, "utf-8").trim();
      tokenSource = "file";
    } catch {
      // File read failed — fall through.
    }
  } else if (process.env.BAJOSEEK_TOKEN && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    token = process.env.BAJOSEEK_TOKEN;
    tokenSource = "env";
  }

  // BotId env fallback (default account only).
  if (!botId && process.env.BAJOSEEK_BOT_ID && resolvedAccountId === DEFAULT_ACCOUNT_ID) {
    botId = process.env.BAJOSEEK_BOT_ID.trim();
  }

  // WebSocket URL: account → channel → default.
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
 *
 * Merges the input fields into the existing config, preserving unspecified values.
 */
export function applyBajoseekAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
  input: { botId?: string; token?: string; tokenFile?: string; name?: string; wsUrl?: string }
): OpenClawConfig {
  const next = { ...cfg };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    // Patch top-level section.
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
    // Patch sub-account.
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
