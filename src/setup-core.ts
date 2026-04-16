/**
 * CLI setup adapter (new OpenClaw 3.24+)
 *
 * Provides a non-interactive setup path for `openclaw setup --channel bajoseek`.
 *
 * Uses `createPatchedAccountSetupAdapter` from `openclaw/plugin-sdk/setup`.
 *
 * Only available on new OpenClaw (3.24+). For old versions, the `setup` adapter
 * on the ChannelPlugin object in channel.ts handles this path directly.
 */
// @ts-ignore — peer dependency, not available at build time
import {createPatchedAccountSetupAdapter, DEFAULT_ACCOUNT_ID,} from "openclaw/plugin-sdk/setup";

const channel = "bajoseek" as const;

/**
 * CLI setup adapter — validates input and builds config patches.
 *
 * Accepted CLI flags:
 *   --bot-token <botId>  — Bajoseek bot ID
 *   --token <token>      — Auth token
 *   --token-file <path>  — Path to token file
 *   --url <wsUrl>        — Custom WebSocket URL
 *   --use-env            — Use env vars BAJOSEEK_BOT_ID / BAJOSEEK_TOKEN
 */
export const bajoseekSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: channel,

  /**
   * Validate CLI input before applying.
   */
  validateInput: ({ accountId, input }: { accountId: any; input: any }) => {
    // Env vars are only supported for the default account.
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
   *
   * When `--use-env` is specified, returns an empty patch (tokens come from env).
   */
  buildPatch: (input: any) =>
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
