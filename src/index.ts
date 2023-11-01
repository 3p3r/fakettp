import debug from "debug";

// @ts-expect-error - webpack takes this.
import * as _http from "http-browserify";
import { createProxyServer } from "./mt";
import { createProxyClient } from "./sw";
import { isRunningInMainThread, isRunningInServiceWorker } from "./common";
import type { RequestListener } from "http";

const log = debug("fakettp");
const _http = (() => {
  try {
    return require("http-browserify");
  } catch (_) {
    return {};
  }
})();

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
  readonly createServer = isRunningInMainThread()
    ? (...args: any[]) => {
        const requestListener = args.find((arg) => typeof arg === "function") as RequestListener;
        const addresses = args.find((arg) => typeof arg === "object")?.["addresses"];
        return createProxyServer(requestListener, addresses);
      }
    : undefined;
}

const instance = new FakeTTP();

export default { ...instance, ..._http };
export const { createServer } = instance;
export const { request, get, Agent, STATUS_CODES } = _http;
