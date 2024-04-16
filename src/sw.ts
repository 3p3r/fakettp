declare const globalThis: ServiceWorkerGlobalScope;

import debug from "debug";
import assert from "assert";
import {
  monotonicId,
  getExcludedPaths,
  serializeRequest,
  SerializedResponse,
  isRunningInServiceWorker,
  MessagePortToReadableStream,
} from "./common";

const log = debug("fakettp:sw");
const SEARCH_VALUE = "polling";
const SEARCH_PARAM = "transport";
const SOCKET_TIMEOUT = 120000; // 2 minutes

function isLongPolling(url: URL) {
  return url.searchParams.has(SEARCH_PARAM) && url.searchParams.get(SEARCH_PARAM) === SEARCH_VALUE;
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
  let timeoutResponse: NodeJS.Timeout | null = null;
  log("processing fetch event: %s", ev.request.url);
  const eventId = monotonicId();
  const requestUrl = new URL(ev.request.url);
  const work = globalThis.clients.matchAll({ type: "window" }).then((clients) =>
    Promise.any([
      ...clients.map((mt) => {
        return new Promise<Response>(async (resolve) => {
          try {
            const requestSerialized = await serializeRequest(ev.request);
            const requestId = requestSerialized.id;
            log("fetch event: %s, id: %d", ev.request.url, requestId);
            const cb = (event: MessageEvent<SerializedResponse>) => {
              if (timeoutResponse) {
                clearTimeout(timeoutResponse);
                timeoutResponse = null;
              }
              log("fetch event: %s, id: %d, response event: %s", ev.request.url, requestId, event.data.id);
              this.delete(requestId);
              const { data: responseInit } = event;
              const responseId = responseInit.id;
              assert(responseId === requestId, "request-response pair id mismatch");
              const responseBody = MessagePortToReadableStream(event.ports[0]);
              log("responding to fetch event: %s, id: %d", ev.request.url, requestId);
              resolve(new Response(responseBody, responseInit));
            };
            Object.assign(cb, { eventId });
            this.set(requestId, cb);
            const { body: requestBody, ...requestRest } = requestSerialized;
            mt.postMessage(requestRest, requestBody ? [requestBody] : []);
          } catch (err) {
            log("sw fetch error: %o", err);
          }
        });
      }),
      new Promise<Response>((resolve) => {
        if (!isLongPolling(requestUrl)) {
          timeoutResponse = setTimeout(() => {
            timeoutResponse = null;
            const eventCbs: number[] = [];
            this.forEach((cb, id) => {
              assert("eventId" in cb);
              if (cb.eventId === eventId) {
                eventCbs.push(id);
              }
            });
            eventCbs.forEach((id) => {
              this.delete(id);
            });
            resolve(
              new Response(null, {
                statusText: "Gateway Timeout",
                status: 504,
              })
            );
          }, SOCKET_TIMEOUT);
        }
      }),
    ])
  );

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
