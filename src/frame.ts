declare const globalThis: Window;

import debug from "debug";
import { RPC } from "@mixer/postmessage-rpc";
import { WindowContext } from "../src/context";
import { getServiceId, isDebugEnabled } from "./common";

const log = debug("fakettp:frame");

if (isDebugEnabled()) debug.enable("*");

async function _installProxyWindow() {
  const serviceId = getServiceId();
  log("installing proxy window with service id: %s", serviceId);
  const rpc = new RPC({
    serviceId,
    target: globalThis.parent,
    receiver: {
      readMessages: (cb) => {
        const _cb = ({ data }: MessageEvent) => cb(data);
        globalThis.addEventListener("message", _cb);
        return () => {
          globalThis.removeEventListener("message", _cb);
        };
      },
    },
  });
  const ctx = new WindowContext();
  log("exposing reload");
  rpc.expose("reload", async () => {
    log("reloading worker via proxy window");
    await ctx.reloadWorker();
  });
  log("exposing unload");
  rpc.expose("unload", async () => {
    log("unloading worker via proxy window");
    await ctx.unloadWorker();
  });
  log("exposing message");
  rpc.expose("message", ({ message }: { message: any }) => {
    ctx.postMessage(message);
  });
  log("forwarding messages to the remote side");
  ctx.readMessages(async (message) => {
    await rpc.isReady;
    await rpc.call("message", { message }, true);
  });
  log("window ready, awaiting rpc connection...");
  await rpc.isReady;
  log("rpc connection established.");
  // ensure rpc is not garbage collected.
  Object.assign(globalThis, { __rpc__: rpc });
}

export function installProxyWindow() {
  if (/complete|interactive|loaded/.test(document.readyState)) _installProxyWindow();
  else window.addEventListener("DOMContentLoaded", _installProxyWindow);
}
