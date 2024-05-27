import { createProxyClient } from "./sw";
import { createProxyServer, IncomingMessage, ServerResponse } from "./mt";
import { getContext, setContext, DefaultContext } from "./context";
import { isRunningInServiceWorker } from "./common";

import type { RequestListener } from "http";

if (isRunningInServiceWorker()) createProxyClient();

const http = {
  ...require("stream-http"),
  getContext,
  setContext,
  DefaultContext,
  ServerResponse,
  IncomingMessage,
  createServer: !isRunningInServiceWorker()
    ? (...args: any[]) => {
        const requestListener = args.find((arg) => typeof arg === "function") as RequestListener;
        return createProxyServer(requestListener);
      }
    : undefined,
  __esModule: true,
};

export = http;
