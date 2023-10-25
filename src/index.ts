import debug from "debug";

import { createProxyServer } from "./mt";
import { createProxyClient } from "./sw";
import { isRunningInMainThread, isRunningInServiceWorker } from "./common";

const log = debug("fakettp");

log("built with webpack mode: %s", process.env.WEBPACK_MODE);
log("webpack bundle filename: %s", process.env.WEBPACK_FILENAME);

if (process.env.WEBPACK_MODE === "development") {
  debug.enable("fakettp*");
  log("debug logging enabled in development mode");
}

class FakeTTP {
  constructor() {
    if (isRunningInServiceWorker()) createProxyClient();
  }
  readonly createServer = isRunningInMainThread() ? createProxyServer : undefined;
}

const instance = new FakeTTP();

export default instance;
export const { createServer } = instance;
