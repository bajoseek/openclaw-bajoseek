/**
 * SDK compatibility layer — SDK 兼容层
 *
 * Provides config-manipulation helpers that work on both old and new OpenClaw versions.
 * 提供在新旧版 OpenClaw 上都能工作的配置操作辅助函数。
 *
 * In new OpenClaw (3.24+) these are exported from `openclaw/plugin-sdk/core`.
 * In old OpenClaw (3.13) they do not exist in the SDK, so we provide local implementations.
 * 新版 (3.24+) 中这些函数从 `openclaw/plugin-sdk/core` 导出。
 * 旧版 (3.13) 中 SDK 不提供这些函数，因此此处提供本地实现。
 *
 * All functions are pure — they return a new config object without mutating the original.
 * 所有函数均为纯函数——返回新配置对象，不修改原始对象。
 */
import type { OpenClawConfig } from "openclaw/plugin-sdk";

/** Sentinel value for the top-level (default) account. / 顶层（默认）账户的标识值。 */
const DEFAULT_ACCOUNT_ID = "default";

/**
 * Set the display name for a channel account.
 * 为频道账户设置显示名称。
 *
 * @param channelKey - The channel section key in config, e.g. "bajoseek".
 *                     配置中的频道区段键名，如 "bajoseek"。
 * @param accountId  - "default" for the top-level account, otherwise the sub-account id.
 *                     顶层账户传 "default"，否则传子账户 ID。
 * @param name       - The display name to set. / 要设置的显示名称。
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
 * 从配置中删除一个频道账户。
 *
 * For the default account, specified base-level fields are cleared instead of
 * removing the entire section.
 * 对于默认账户，清除指定的基础字段而非删除整个区段。
 *
 * @param sectionKey      - The channel section key, e.g. "bajoseek". / 频道区段键名。
 * @param accountId       - Account to delete. / 要删除的账户。
 * @param clearBaseFields - Fields to clear when deleting the default account.
 *                          删除默认账户时需清除的字段列表。
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
    // Clear specified top-level fields. / 清除指定的顶层字段。
    for (const field of clearBaseFields ?? []) {
      delete section[field];
    }
    return {
      ...cfg,
      channels: { ...cfg.channels, [sectionKey]: section },
    } as OpenClawConfig;
  }

  // Remove the sub-account entry. / 移除子账户条目。
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
 * 启用或禁用一个频道账户。
 *
 * @param sectionKey    - The channel section key. / 频道区段键名。
 * @param accountId     - Target account. / 目标账户。
 * @param enabled       - Whether to enable or disable. / 是否启用。
 * @param allowTopLevel - If true and accountId is "default", sets `enabled` at the
 *                        channel section level rather than inside `accounts`.
 *                        为 true 且 accountId 为 "default" 时，在频道区段顶层设置 enabled。
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
