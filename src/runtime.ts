import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setBajoseekRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getBajoseekRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Bajoseek runtime not initialized");
  }
  return runtime;
}
