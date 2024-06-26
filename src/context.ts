/// <reference lib="dom" />
/// <reference lib="webworker" />

import debug from "debug";
import assert from "assert";
import { RPC } from "justmessage-rpc";
import { backOff } from "exponential-backoff";
import { EventEmitter } from "events";

import { type FullConfig, type PartConfig, getConfigFromLocation, isDebugEnabled } from "./common";

const log = debug("fakettp:context");

type CleanupReceiver = () => void | Promise<void>;
type MessageReceiver = (message: any) => void | Promise<void>;

export interface Context {
  readonly postMessage: MessageReceiver;
  readonly recvMessage: (callback: MessageReceiver) => CleanupReceiver;
  readonly reloadWorker?: () => void | Promise<void>;
  readonly unloadWorker?: () => void | Promise<void>;
}

export class RemoteContext implements Context {
  private readonly _emitter = new EventEmitter();

  constructor(protected readonly rpc: RPC) {
    this._emitter.setMaxListeners(0); // fixme
    this.rpc.expose("message", ({ message }: { message: any }) => {
      this._emitter.emit("message", message);
    });
  }

  async postMessage(message: any) {
    log("posting message %o via remote context", message);
    await this.rpc.isReady;
    await this.rpc.call("message", { message }, true);
  }

  recvMessage(callback: MessageReceiver) {
    this._emitter.on("message", callback);
    return () => {
      this._emitter.off("message", callback);
    };
  }

  async reloadWorker() {
    log("reloading worker via remote context");
    await this.rpc.isReady;
    await this.rpc.call("reload", {}, true);
  }

  async unloadWorker() {
    log("unloading worker via remote context");
    await this.rpc.isReady;
    await this.rpc.call("unload", {}, true);
  }

  async browse(url: string) {
    log("browsing to %s via remote context", url);
    await this.rpc.isReady;
    await this.rpc.call("browse", { url }, true);
  }
}

function getReferencedWindow(el: HTMLElement) {
  const doc = el.ownerDocument;
  if (!doc) return null;
  return doc.defaultView;
}

export class IFrameContext extends RemoteContext {
  constructor(readonly frame: HTMLIFrameElement) {
    const serviceId = `fakettp:${new URL(frame.src).href}`;
    log("remote service ID: %s", serviceId);
    super(
      new RPC({
        serviceId,
        target: {
          postMessage: (message) => {
            frame.contentWindow?.postMessage(message, "*");
          },
        },
        receiver: {
          recvMessage: (cb) => {
            const _cb = ({ data }: MessageEvent) => cb(data);
            getReferencedWindow(frame)?.addEventListener("message", _cb);
            return () => {
              getReferencedWindow(frame)?.removeEventListener("message", _cb);
            };
          },
        },
      })
    );
  }
}

export class WindowContext implements Context {
  private _worker: ServiceWorker | null = null;
  private readonly _config: Required<PartConfig>;

  constructor(config?: Partial<FullConfig>) {
    const locationConfig = getConfigFromLocation();
    this._config = {
      include: [...(config?.include?.map((i) => i.source) || []), ...locationConfig.include],
      exclude: [...(config?.exclude?.map((i) => i.source) || []), ...locationConfig.exclude],
    };
  }

  postMessage(message: any) {
    this._worker?.postMessage(message);
  }

  recvMessage(callback: MessageReceiver) {
    const cb = (event: MessageEvent) => {
      callback(event.data);
    };
    navigator.serviceWorker.addEventListener("message", cb);
    return () => {
      navigator.serviceWorker.removeEventListener("message", cb);
    };
  }

  async reloadWorker() {
    if (this._worker) {
      await this.unloadWorker();
    }
    const query = new URLSearchParams();
    if (isDebugEnabled()) query.append("d", "");
    this._config.include.forEach((i) => query.append("i", i));
    this._config.exclude.forEach((e) => query.append("e", e));
    const queryString = query.toString();
    log("reloading worker with query: %s", queryString);
    navigator.serviceWorker.register(`fakettp.js?${queryString}`, { updateViaCache: "none", scope: "/" });
    await this._waitForControllerChange();
    await this._waitForWorkerLoad();
    const reg = await navigator.serviceWorker.ready;
    this._worker = reg.active;
    globalThis.addEventListener("beforeunload", this._selfDestruct);
  }

  async unloadWorker() {
    if (!this._worker) return;
    log("unloading worker");
    navigator.serviceWorker.ready.then((r) => r.unregister());
    navigator.serviceWorker.register("nosw.js", { updateViaCache: "none", scope: "/" });
    await this._waitForControllerChange();
    await this._waitForWorkerStop();
    this._worker = null;
    globalThis.removeEventListener("beforeunload", this._selfDestruct);
  }

  private _selfDestruct = (ev: BeforeUnloadEvent) => {
    log("attempting to unload worker via proxy window");
    const beforeunloadRequest = require("beforeunload-request");
    const success = beforeunloadRequest("/__self_destruct__");
    if (!success) {
      ev.preventDefault();
      ev.returnValue = "";
    }
  };

  private async _waitForControllerChange() {
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
    });
  }

  private async _waitForWorkerStop() {
    const _work = async () => {
      const response = await fetch(`/__status__`);
      assert(response.status !== 200);
    };
    await backOff(_work);
  }

  private async _waitForWorkerLoad() {
    const _work = async () => {
      const response = await fetch(`/__status__`);
      assert(response.status === 200);
    };
    await backOff(_work);
  }
}

let _context: Context | null = null;
export const getContext = () => {
  if (!_context) {
    log("creating a default context. use setContext to override this.");
    _context = new WindowContext();
  }
  return _context;
};
export const setContext = (context: Context) => {
  _context = context;
};
