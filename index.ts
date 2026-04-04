/**
 * Plugin entry point
 *
 * Compatible with both old (3.13) and new (3.24+) OpenClaw versions.
 *
 * Uses the `register(api)` pattern which both versions' loaders support:
 *   - New (3.24+): loader calls `register` (same as `defineChannelPluginEntry` produces).
 *   - Old (3.13):  loader calls `register` or `activate`.
 */

import {bajoseekPlugin} from "./src/channel.js";
import {setBajoseekRuntime} from "./src/runtime.js";

/* ── Public re-exports ── */
export { bajoseekPlugin } from "./src/channel.js";
export { setBajoseekRuntime, getBajoseekRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";

/* ── Default export — register pattern ── */
export default {
  id: "bajoseek",
  name: "Bajoseek",
  description: "Bajoseek channel plugin",
  register(api: any) {
    setBajoseekRuntime(api.runtime);
    api.registerChannel(bajoseekPlugin);
  },
};
