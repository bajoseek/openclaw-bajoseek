import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";

import { bajoseekPlugin } from "./src/channel.js";
import { setBajoseekRuntime } from "./src/runtime.js";

const plugin = {
  id: "bajoseek",
  name: "Bajoseek",
  description: "Bajoseek channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setBajoseekRuntime(api.runtime);
    api.registerChannel({ plugin: bajoseekPlugin });
  },
};

export default plugin;

export { bajoseekPlugin } from "./src/channel.js";
export { setBajoseekRuntime, getBajoseekRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/config.js";
export * from "./src/gateway.js";
export * from "./src/outbound.js";
