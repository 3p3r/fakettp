declare const globalThis: ServiceWorkerGlobalScope;

import debug from "debug";
import assert from "assert";
import {
  ARM,
  FIN,
  defaultHost,
  defaultPort,
  serializeRequest,
  SerializedResponse,
  type ProxyWorkerInstance,
  isRunningInServiceWorker,
  getBundledWorkerFileName,
  MessagePortToReadableStream,
} from "./common";

const log = debug("fakettp:sw");

function isMe(url: URL) {
  return globalThis.location.origin === url.origin && url.pathname.includes(getBundledWorkerFileName());
}

function isLongPolling(url: URL) {
  return url.pathname.includes("/socket.io/") || url.pathname.includes("/engine.io/");
}

function onFetch(this: ProxyWorkerInstance, ev: FetchEvent) {
  const _bypass = () => ev.respondWith(fetch(ev.request));
  log("fetch event: %s", ev.request.url);
  if (!this.armed) {
    log("unarmed, letting browser handle request: %s", ev.request.url);
    return _bypass();
  }
  if (ev.request.bodyUsed) {
    log("request already handled by a redundant sw instance: %s", ev.request.url);
    return _bypass();
  }
  if ("isReload" in ev && ev.isReload) {
    log("request is a reload. disarming: %s", ev.request.url);
    this.disarm();
    return _bypass();
  }
  ev.respondWith(
    new Promise((resolve, reject) => {
      this.mt
        .then(async (mt) => {
          log("processing fetch event: %s", ev.request.url);
          const requestUrl = new URL(ev.request.url);
          const requestSerialized = await serializeRequest(ev.request);
          const requestId = requestSerialized.id;
          log("fetch event: %s, id: %d", ev.request.url, requestId);
          let timer: NodeJS.Timeout | null = null;
          this.listeners.set(requestId, (event: MessageEvent<SerializedResponse>) => {
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            log("fetch event: %s, id: %d, response event: %s", ev.request.url, requestId, event.data.id);
            this.listeners.delete(requestId);
            const { data: responseInit } = event;
            const responseId = responseInit.id;
            assert(responseId === requestId, "request-response pair id mismatch");
            const responseBody = MessagePortToReadableStream(event.ports[0]);
            log("responding to fetch event: %s, id: %d", ev.request.url, requestId);
            resolve(new Response(responseBody, responseInit));
          });
          const { body: requestBody, ...requestRest } = requestSerialized;
          mt?.postMessage(requestRest, requestBody ? [requestBody] : []);
          if (!isLongPolling(requestUrl)) {
            timer = setTimeout(() => {
              timer = null;
              if (this.listeners.has(requestId)) {
                log("mt response timed out: %s", ev.request.url);
                this.listeners.delete(requestId);
                resolve(fetch(ev.request));
              }
            }, 30000);
          }
        })
        .catch(reject);
    })
  );
}

function onMessage(
  this: ProxyWorkerInstance,
  event: MessageEvent<SerializedResponse | typeof ARM | typeof FIN | [string, string]>
) {
  if (event.data === ARM) {
    this.arm().then(() => {
      this.mt.then((mt) => mt.postMessage(ARM));
    });
    return;
  }
  if (event.data === FIN) {
    log("FIN received from mt. bye.");
    Promise.all([this.disarm(), globalThis.skipWaiting(), globalThis.registration.unregister()]).then(() => {
      this.mt.then((mt) => mt?.postMessage(FIN));
    });
    this.listeners.clear();
    globalThis.removeEventListener("fetch", onFetch);
    globalThis.removeEventListener("message", onMessage);
    globalThis.removeEventListener("install", onInstall);
    globalThis.removeEventListener("activate", onActivate);
    return;
  }
  if (Array.isArray(event.data)) {
    log("address received from mt: %s:%s", event.data[0], event.data[1]);
    this.host = event.data[0];
    this.port = event.data[1];
    return;
  }
  const { data: responseInit } = event;
  const responseId = responseInit.id;
  if (this.listeners.has(responseId)) {
    const messageListener = this.listeners.get(responseId);
    messageListener(event as MessageEvent<SerializedResponse>);
  } else {
    log("message event: %d, no listener found", responseId);
  }
}

function onInstall(this: ProxyWorkerInstance, event: ExtendableEvent) {
  log("installing");
  event.waitUntil(this.disarm());
  return globalThis.skipWaiting();
}

function onActivate(this: ProxyWorkerInstance, event: ExtendableEvent) {
  log("activating");
  event.waitUntil(this.disarm());
  if (globalThis.registration && globalThis.registration.navigationPreload) {
    event.waitUntil(
      globalThis.registration.navigationPreload.disable().then(() => {
        log("navigationPreload disabled");
      })
    );
  }
  return globalThis.clients.claim();
}

function createProxyInstance(): ProxyWorkerInstance {
  const listeners = new Map<number, (event: MessageEvent<SerializedResponse>) => void>();
  let armed = false;
  let mt: Promise<Client | null> = null;
  return {
    sw: globalThis,
    get armed() {
      return armed;
    },
    get mt() {
      if (mt) return mt;
      log("getting mt");
      mt = globalThis.clients
        .matchAll({ type: "window" })
        .then((clients) => clients.find((client) => client.frameType === "top-level"));
      return mt;
    },
    async arm() {
      log("arming");
      armed = true;
    },
    async disarm() {
      log("disarming");
      armed = false;
      mt = null;
    },
    listeners,
    host: defaultHost,
    port: defaultPort,
  };
}

export function createProxyClient() {
  log("creating sw client");
  assert(isRunningInServiceWorker());
  const proxyInstance = createProxyInstance();
  globalThis.addEventListener("fetch", onFetch.bind(proxyInstance));
  globalThis.addEventListener("message", onMessage.bind(proxyInstance));
  globalThis.addEventListener("install", onInstall.bind(proxyInstance));
  globalThis.addEventListener("activate", onActivate.bind(proxyInstance));
}
