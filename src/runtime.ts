/**
 * Plugin runtime singleton
 *
 * Stores the OpenClaw PluginRuntime reference injected during plugin registration.
 *
 * Uses `any` instead of the concrete `PluginRuntime` type to avoid import-path
 * differences between old and new OpenClaw versions.
 */

let runtime: any = null;

/**
 * Set the runtime — called once during plugin registration.
 */
export function setBajoseekRuntime(next: any) {
  runtime = next;
}

/**
 * Get the runtime — throws if not yet initialised.
 */
export function getBajoseekRuntime(): any {
  if (!runtime) {
    throw new Error("Bajoseek runtime not initialized");
  }
  return runtime;
}
