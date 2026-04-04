/**
 * Setup-only entry point
 *
 * Used by OpenClaw when only the interactive setup wizard is needed.
 *
 * Returns `{ plugin }` — the shape both old and new versions expect.
 */

import {bajoseekPlugin} from "./src/channel.js";

export default { plugin: bajoseekPlugin };
