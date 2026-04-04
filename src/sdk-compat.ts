/**
 * SDK compatibility layer
 *
 * Provides config-manipulation helpers that work on both old and new OpenClaw versions.
 *
 * In new OpenClaw (3.24+) these are exported from `openclaw/plugin-sdk/core`.
 * In old OpenClaw (3.13) they do not exist in the SDK, so we provide local implementations.
 *
 * All functions are pure — they return a new config object without mutating the original.
 */

import type {OpenClawConfig} from "openclaw/plugin-sdk";

/** Sentinel value for the top-level (default) account. */
const DEFAULT_ACCOUNT_ID = "default";

/**
 * Set the display name for a channel account.
 *
 * @param channelKey - The channel section key in config, e.g. "bajoseek".
 * @param accountId  - "default" for the top-level account, otherwise the sub-account id.
 * @param name       - The display name to set.
 */
export function applyAccountNameToChannelSection(params: {
  cfg: OpenClawConfig;
  channelKey: string;
  accountId: string;
  name: string;
}): OpenClawConfig {
  const { cfg, channelKey, accountId, name } = params;
  const section = (cfg.channels as Record<string, any>)?.[channelKey] ?? {};

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: { ...cfg.channels, [channelKey]: { ...section, name } },
    } as OpenClawConfig;
  }

  const accounts = section.accounts ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channelKey]: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], name },
        },
      },
    },
  } as OpenClawConfig;
}

/**
 * Delete a channel account from config.
 *
 * For the default account, specified base-level fields are cleared instead of
 * removing the entire section.
 *
 * @param sectionKey      - The channel section key, e.g. "bajoseek".
 * @param accountId       - Account to delete.
 * @param clearBaseFields - Fields to clear when deleting the default account.
 */
export function deleteAccountFromConfigSection(params: {
  cfg: OpenClawConfig;
  sectionKey: string;
  accountId: string;
  clearBaseFields?: string[];
}): OpenClawConfig {
  const { cfg, sectionKey, accountId, clearBaseFields } = params;
  const section = { ...((cfg.channels as Record<string, any>)?.[sectionKey] ?? {}) };

  if (accountId === DEFAULT_ACCOUNT_ID) {
    // Clear specified top-level fields.
    for (const field of clearBaseFields ?? []) {
      delete section[field];
    }
    return {
      ...cfg,
      channels: { ...cfg.channels, [sectionKey]: section },
    } as OpenClawConfig;
  }

  // Remove the sub-account entry.
  const accounts = { ...(section.accounts ?? {}) };
  delete accounts[accountId];
  section.accounts = accounts;
  return {
    ...cfg,
    channels: { ...cfg.channels, [sectionKey]: section },
  } as OpenClawConfig;
}

/**
 * Enable or disable a channel account.
 *
 * @param sectionKey    - The channel section key.
 * @param accountId     - Target account.
 * @param enabled       - Whether to enable or disable.
 * @param allowTopLevel - If true and accountId is "default", sets `enabled` at the
 *                        channel section level rather than inside `accounts`.
 */
export function setAccountEnabledInConfigSection(params: {
  cfg: OpenClawConfig;
  sectionKey: string;
  accountId: string;
  enabled: boolean;
  allowTopLevel?: boolean;
}): OpenClawConfig {
  const { cfg, sectionKey, accountId, enabled, allowTopLevel } = params;
  const section = (cfg.channels as Record<string, any>)?.[sectionKey] ?? {};

  if (accountId === DEFAULT_ACCOUNT_ID && allowTopLevel) {
    return {
      ...cfg,
      channels: { ...cfg.channels, [sectionKey]: { ...section, enabled } },
    } as OpenClawConfig;
  }

  const accounts = section.accounts ?? {};
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [sectionKey]: {
        ...section,
        accounts: {
          ...accounts,
          [accountId]: { ...accounts[accountId], enabled },
        },
      },
    },
  } as OpenClawConfig;
}
