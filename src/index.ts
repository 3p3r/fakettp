import debug from "debug";

import { createProxyClient } from "./sw";
import { createProxyServer, IncomingMessage, ServerResponse } from "./mt";
import { isRunningInBrowserWindow, isRunningInServiceWorker } from "./common";

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
  ServerResponse,
  IncomingMessage,
  createServer: isRunningInBrowserWindow()
    ? (...args: any[]) => {
        const requestListener = args.find((arg) => typeof arg === "function") as RequestListener;
        const scope: string | undefined = args.find((arg) => typeof arg === "object")?.["scope"];
        return createProxyServer(requestListener, scope);
      }
    : undefined,
  __esModule: true,
};

export = http;
