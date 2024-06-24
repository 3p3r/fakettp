import debug from "debug";

import { installProxyWorker } from "./sw";
import { installProxyWindow } from "./frame";
import { createProxyServer, IncomingMessage, ServerResponse } from "./mt";
import { isRunningInServiceWorker, isRunningInServiceWindow, isDebugEnabled } from "./common";
import { getContext, setContext, WindowContext, RemoteContext, IFrameContext } from "./context";

import { RPC } from "@mixer/postmessage-rpc";
import type { RequestListener } from "http";

if (isDebugEnabled()) debug.enable("*");

if (isRunningInServiceWorker()) installProxyWorker();
if (isRunningInServiceWindow()) installProxyWindow();

const http = {
  ...require("stream-http"),
  RPC,
  getContext,
  setContext,
  IFrameContext,
  WindowContext,
  RemoteContext,
  ServerResponse,
  IncomingMessage,
  createServer:
    !isRunningInServiceWorker() && !isRunningInServiceWindow()
      ? (...args: any[]) => {
          const requestListener = args.find((arg) => typeof arg === "function") as RequestListener;
          return createProxyServer(requestListener);
        }
      : undefined,
  __esModule: true,
};

export = http;
