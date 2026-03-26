/**
 * Plugin runtime singleton — 插件运行时单例
 *
 * Stores the OpenClaw PluginRuntime reference injected during plugin registration.
 * 保存插件注册阶段注入的 OpenClaw PluginRuntime 引用。
 *
 * Uses `any` instead of the concrete `PluginRuntime` type to avoid import-path
 * differences between old and new OpenClaw versions.
 * 使用 `any` 代替具体的 `PluginRuntime` 类型，以避免新旧版 OpenClaw 导入路径差异。
 */

let runtime: any = null;

/**
 * Set the runtime — called once during plugin registration.
 * 设置运行时——在插件注册阶段调用一次。
 */
export function setBajoseekRuntime(next: any) {
  runtime = next;
}

/**
 * Get the runtime — throws if not yet initialised.
 * 获取运行时——未初始化时抛出异常。
 */
export function getBajoseekRuntime(): any {
  if (!runtime) {
    throw new Error("Bajoseek runtime not initialized");
  }
  return runtime;
}
