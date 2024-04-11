import debug from "debug";

import { createProxyClient } from "./sw";
import { isRunningInBrowserWindow, isRunningInServiceWorker } from "./common";
import { createProxyServer, IncomingMessage, ServerResponse, unload } from "./mt";

import type { RequestListener } from "http";

const log = debug("fakettp");
const _http = (() => {
  try {
    return require("stream-http");
  } catch (_) {
    return {};
  }
})();

log("built with webpack mode: %s", process.env.WEBPACK_MODE);
log("webpack bundle filename: %s", process.env.WEBPACK_FILENAME);

if (isRunningInServiceWorker()) createProxyClient();

const http = {
  ..._http,
  unload,
  ServerResponse,
  IncomingMessage,
  createServer: isRunningInBrowserWindow()
    ? (...args: any[]) => {
      const requestListener = args.find((arg) => typeof arg === "function") as RequestListener;
      return createProxyServer(requestListener);
    }
    : undefined,
  __esModule: true,
};

export = http;
