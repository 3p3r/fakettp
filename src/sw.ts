declare const globalThis: ServiceWorkerGlobalScope;

import debug from "debug";
import assert from "assert";
import {
  defaultHost,
  defaultPort,
  serializeRequest,
  SerializedResponse,
  type ProxyWorkerInstance,
  isRunningInServiceWorker,
  MessagePortToReadableStream,
} from "./common";

const log = debug("fakettp:sw");
const SOCKET_TIMEOUT = 120000; // 2 minutes

function isLongPolling(url: URL) {
  return url.pathname.includes("/socket.io/") || url.pathname.includes("/engine.io/");
}

function onFetch(this: ProxyWorkerInstance, ev: FetchEvent) {
  const _bypass = () => ev.respondWith(fetch(ev.request));
  log("fetch event: %s", ev.request.url);
  if (ev.request.bodyUsed) {
    log("request already handled by a redundant sw instance: %s", ev.request.url);
    return _bypass();
  }
  if ("isReload" in ev && ev.isReload) {
    log("request is a reload. disarming: %s", ev.request.url);
    this.disarm();
    return _bypass();
  }
  if (ev.request.url.endsWith("/__status__")) {
    log("request is a status check: %s", ev.request.url);
    return ev.respondWith(new Response("OK"));
  }
  ev.respondWith(
    new Promise((resolve, reject) => {
      this.mt
        .then(async (mt) => {
          try {
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
            mt.postMessage(requestRest, requestBody ? [requestBody] : []);
            if (!isLongPolling(requestUrl)) {
              timer = setTimeout(() => {
                timer = null;
                if (this.listeners.has(requestId)) {
                  log("mt response timed out: %s", ev.request.url);
                  this.listeners.delete(requestId);
                  resolve(fetch(ev.request));
                }
              }, SOCKET_TIMEOUT);
            }
          } catch (err) {
            log("error: %o", err);
            reject(err);
          }
        })
        .catch(reject);
    })
  );
}

function onMessage(this: ProxyWorkerInstance, event: MessageEvent<SerializedResponse>) {
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
  return {
    sw: globalThis,
    get armed() {
      return true;
    },
    get mt() {
      return globalThis.clients
        .matchAll({ type: "window" })
        .then((clients) => ({ clients, candidate: clients.find((client) => client.frameType === "top-level") }))
        .then(({ clients, candidate }) =>
          candidate && candidate.postMessage ? candidate : clients.find((client) => client.frameType === "nested")
        );
    },
    async arm() {
      log("arming");
    },
    async disarm() {
      log("disarming");
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
