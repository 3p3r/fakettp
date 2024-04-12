declare const globalThis: ServiceWorkerGlobalScope;

import debug from "debug";
import assert from "assert";
import {
  serializeRequest,
  SerializedResponse,
  isRunningInServiceWorker,
  MessagePortToReadableStream,
  getExcludedPaths,
} from "./common";

const log = debug("fakettp:sw");
const SOCKET_TIMEOUT = 120000; // 2 minutes

function isLongPolling(url: URL) {
  return url.pathname.includes("/socket.io/") || url.pathname.includes("/engine.io/");
}

async function onFetch(this: Listeners, ev: FetchEvent) {
  const _bypass = () => ev.respondWith(fetch(ev.request));
  log("fetch event: %s", ev.request.url);
  if (ev.request.bodyUsed) {
    log("request already handled by a redundant sw instance: %s", ev.request.url);
    return _bypass();
  }
  if ("isReload" in ev && ev.isReload) {
    log("request is a reload. disarming: %s", ev.request.url);
    return _bypass();
  }
  if (ev.request.url.endsWith("/__status__")) {
    log("request is a status check: %s", ev.request.url);
    return ev.respondWith(new Response("OK"));
  }
  if (getExcludedPaths().some((path) => ev.request.url.endsWith(path))) {
    log("request is excluded from interception: %s", ev.request.url);
    return _bypass();
  }
  let timer: NodeJS.Timeout | null = null;
  const work = globalThis.clients.matchAll({ type: "window" }).then((clients) => {
    return Promise.any(
      clients.map((mt) => {
        log("processing fetch event: %s", ev.request.url);
        const requestUrl = new URL(ev.request.url);
        return new Promise<Response>(async (resolve, reject) => {
          try {
            const requestSerialized = await serializeRequest(ev.request);
            const requestId = requestSerialized.id;
            log("fetch event: %s, id: %d", ev.request.url, requestId);
            this.set(requestId, (event: MessageEvent<SerializedResponse>) => {
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              log("fetch event: %s, id: %d, response event: %s", ev.request.url, requestId, event.data.id);
              this.delete(requestId);
              const { data: responseInit } = event;
              const responseId = responseInit.id;
              assert(responseId === requestId, "request-response pair id mismatch");
              const responseBody = MessagePortToReadableStream(event.ports[0]);
              log("responding to fetch event: %s, id: %d", ev.request.url, requestId);
              resolve(new Response(responseBody, responseInit));
            });
            const { body: requestBody, ...requestRest } = requestSerialized;
            mt.postMessage(requestRest, requestBody ? [requestBody] : []);
          } catch (err) {
            log("error: %o", err);
            reject(err);
          }
          if (!isLongPolling(requestUrl)) {
            timer = setTimeout(() => {
              timer = null;
              resolve(new Response(null, { status: 504, statusText: "Gateway Timeout" }));
            }, SOCKET_TIMEOUT);
          }
        });
      })
    );
  });

  ev.respondWith(work);
}

function onMessage(this: Listeners, event: MessageEvent<SerializedResponse>) {
  const { data: responseInit } = event;
  const responseId = responseInit.id;
  if (this.has(responseId)) {
    const messageListener = this.get(responseId);
    messageListener(event as MessageEvent<SerializedResponse>);
  } else {
    log("message event: %d, no listener found", responseId);
  }
}

function onInstall() {
  log("installing");
  return globalThis.skipWaiting();
}

function onActivate(event: ExtendableEvent) {
  log("activating");
  if (globalThis.registration && globalThis.registration.navigationPreload) {
    event.waitUntil(
      globalThis.registration.navigationPreload.disable().then(() => {
        log("navigationPreload disabled");
      })
    );
  }
  return globalThis.clients.claim();
}

export type Listeners = Map<number, (event: MessageEvent<SerializedResponse>) => void>;

export function createProxyClient() {
  log("creating sw client");
  assert(isRunningInServiceWorker());
  const listeners: Listeners = new Map();
  globalThis.addEventListener("fetch", onFetch.bind(listeners));
  globalThis.addEventListener("message", onMessage.bind(listeners));
  globalThis.addEventListener("install", onInstall);
  globalThis.addEventListener("activate", onActivate);
}
