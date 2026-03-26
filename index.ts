/**
 * Plugin entry point — 插件主入口
 *
 * Compatible with both old (3.13) and new (3.24+) OpenClaw versions.
 * 兼容新旧版 OpenClaw。
 *
 * Uses the `register(api)` pattern which both versions' loaders support:
 * 使用两个版本的加载器都支持的 `register(api)` 模式：
 *   - New (3.24+): loader calls `register` (same as `defineChannelPluginEntry` produces).
 *     新版加载器调用 `register`（与 `defineChannelPluginEntry` 产出一致）。
 *   - Old (3.13):  loader calls `register` or `activate`.
 *     旧版加载器调用 `register` 或 `activate`。
 */

import { bajoseekPlugin } from "./src/channel.js";
import { setBajoseekRuntime } from "./src/runtime.js";

/* ── Public re-exports / 公共再导出 ── */
export { bajoseekPlugin } from "./src/channel.js";
export { setBajoseekRuntime, getBajoseekRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";

/* ── Default export — register pattern / 默认导出——register 模式 ── */
export default {
  id: "bajoseek",
  name: "Bajoseek",
  description: "Bajoseek channel plugin",
  register(api: any) {
    setBajoseekRuntime(api.runtime);
    api.registerChannel(bajoseekPlugin);
  },
};
