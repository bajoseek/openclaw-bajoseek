/**
 * Setup-only entry point — Setup 专用入口
 *
 * Used by OpenClaw when only the interactive setup wizard is needed.
 * 当 OpenClaw 仅需要交互式配置向导时使用此入口。
 *
 * Returns `{ plugin }` — the shape both old and new versions expect.
 * 返回 `{ plugin }`——新旧版本都期望的结构。
 */

import { bajoseekPlugin } from "./src/channel.js";

export default { plugin: bajoseekPlugin };
