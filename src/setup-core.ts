/**
 * CLI setup adapter — CLI 配置适配器 (new OpenClaw 3.24+)
 *
 * Provides a non-interactive setup path for `openclaw setup --channel bajoseek`.
 * 为 `openclaw setup --channel bajoseek` 提供非交互式配置路径。
 *
 * Uses `createPatchedAccountSetupAdapter` from `openclaw/plugin-sdk/setup`.
 * 使用 `openclaw/plugin-sdk/setup` 的 `createPatchedAccountSetupAdapter`。
 *
 * Only available on new OpenClaw (3.24+). For old versions, the `setup` adapter
 * on the ChannelPlugin object in channel.ts handles this path directly.
 * 仅在新版 OpenClaw (3.24+) 可用。旧版由 channel.ts 中 ChannelPlugin 的 setup 适配器直接处理。
 */
import {
  createPatchedAccountSetupAdapter,
  DEFAULT_ACCOUNT_ID,
} from "openclaw/plugin-sdk/setup";

const channel = "bajoseek" as const;

/**
 * CLI setup adapter — validates input and builds config patches.
 * CLI 配置适配器——校验输入并构建配置补丁。
 *
 * Accepted CLI flags / 接受的 CLI 参数:
 *   --bot-token <botId>  — Bajoseek bot ID
 *   --token <token>      — Auth token / 认证 Token
 *   --token-file <path>  — Path to token file / Token 文件路径
 *   --url <wsUrl>        — Custom WebSocket URL / 自定义 WebSocket 地址
 *   --use-env            — Use env vars BAJOSEEK_BOT_ID / BAJOSEEK_TOKEN
 *                          使用环境变量
 */
export const bajoseekSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: channel,

  /**
   * Validate CLI input before applying.
   * 应用前校验 CLI 输入。
   */
  validateInput: ({ accountId, input }) => {
    // Env vars are only supported for the default account.
    // 环境变量仅支持默认账户。
    if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
      return "BAJOSEEK_BOT_ID / BAJOSEEK_TOKEN can only be used for the default account.";
    }
    if (!input.useEnv && !input.botToken) {
      return "Bajoseek requires --bot-token <botId> --token <token> [--url <wsUrl>], or --use-env";
    }
    if (!input.useEnv && !input.token && !input.tokenFile) {
      return "Bajoseek requires --token <token>";
    }
    return null;
  },

  /**
   * Build the config patch from CLI input.
   * 根据 CLI 输入构建配置补丁。
   *
   * When `--use-env` is specified, returns an empty patch (tokens come from env).
   * 指定 `--use-env` 时返回空补丁（Token 来自环境变量）。
   */
  buildPatch: (input) =>
    input.useEnv
      ? {}
      : {
          ...(input.botToken ? { botId: input.botToken } : {}),
          ...(input.token
            ? { token: input.token }
            : input.tokenFile
              ? { tokenFile: input.tokenFile }
              : {}),
          ...(input.url ? { wsUrl: input.url } : {}),
        },
});
