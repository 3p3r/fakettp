declare const globalThis: ServiceWorkerGlobalScope;

import debug from "debug";
import assert from "assert";
import { EventEmitter } from "events";

import { MessagePort } from "./channel";
import { type Context, setContext } from "./context";
import {
  uniqueId,
  Singleton,
  isDebugEnabled,
  type FullConfig,
  serializeRequest,
  SerializedResponse,
  getConfigFromLocation,
  isRunningInServiceWorker,
  MessagePortToReadableStream,
} from "./common";

if (isDebugEnabled()) debug.enable("*");

const log = debug("fakettp:sw");
const emitter = new EventEmitter();
const SEARCH_VALUE = "polling";
const SEARCH_PARAM = "transport";
const SOCKET_TIMEOUT = 120000; // 2 minutes

emitter.setMaxListeners(0); // fixme

function isLongPolling(url: URL) {
  return url.searchParams.has(SEARCH_PARAM) && url.searchParams.get(SEARCH_PARAM) === SEARCH_VALUE;
}

async function getClients() {
  return globalThis.clients.matchAll({ type: "window" });
}

class WindowClientContext implements Context {
  constructor(private readonly client: WindowClient) {}
  postMessage(message: any) {
    this.client.postMessage(message);
  }
  recvMessage(callback: any) {
    emitter.on("message", callback);
    return () => {
      emitter.off("message", callback);
    };
  }
}

async function onFetch(this: Listeners, ev: FetchEvent) {
  const _bypass = () => ev.respondWith(fetch(ev.request));
  log("fetch event: %s", ev.request.url);
  if (ev.request.bodyUsed) {
    log("request already handled by a redundant sw instance: %s", ev.request.url);
    return _bypass();
  }
  if ("isReload" in ev && ev.isReload) {
    log("request is a reload. bypassing: %s", ev.request.url);
    return _bypass();
  }
  if (ev.request.url.endsWith("/__status__")) {
    log("request is a status check: %s", ev.request.url);
    return ev.respondWith(new Response("OK"));
  }
  if (ev.request.url.endsWith("/__self_destruct__")) {
    log("request is a self destruct: %s", ev.request.url);
    emitter.emit("self-destruct");
    await globalThis.registration.unregister();
    emitter.removeAllListeners();
    this.clear();
    globalThis.removeEventListener("fetch", onFetch);
    globalThis.removeEventListener("message", onMessage);
    globalThis.removeEventListener("install", onInstall);
    globalThis.removeEventListener("activate", onActivate);
    return ev.respondWith(new Response("OK"));
  }
  log("processing fetch event: %s", ev.request.url);
  const requestUrl = new URL(ev.request.url);
  const config = getConfig();
  const include = config.include.some((re) => re.test(requestUrl.href));
  const exclude = config.exclude.some((re) => re.test(requestUrl.href));
  if (exclude || !include) {
    log("bypassing '%s' include: %o, exclude: %o config: %o", ev.request.url, include, exclude, config);
    return _bypass();
  }
  let abortedResponse: () => void | null = null;
  let timeoutResponse: NodeJS.Timeout | null = null;
  const eventId = uniqueId();
  const work = getClients().then((clients) =>
    Promise.any([
      ...clients.map((mt) => {
        return new Promise<Response>(async (resolve) => {
          try {
            const requestSerialized = await serializeRequest(ev.request);
            const requestId = requestSerialized.id;
            log("fetch event: %s, id: %s", ev.request.url, requestId);
            const cb = (responseInit: SerializedResponse) => {
              if (timeoutResponse) {
                clearTimeout(timeoutResponse);
                timeoutResponse = null;
              }
              log("fetch event: %s, id: %s, response event: %s", ev.request.url, requestId, responseInit.id);
              this.delete(requestId);
              const responseId = responseInit.id;
              assert(responseId === requestId, "fakettp: request-response pair id mismatch");
              log("streaming response: %s", responseInit.body);
              const responseBody = MessagePortToReadableStream(
                new MessagePort(responseInit.body, new WindowClientContext(mt))
              );
              log("responding to fetch event: %s, id: %s", ev.request.url, requestId);
              resolve(new Response(responseBody, responseInit));
            };
            Object.assign(cb, { eventId });
            this.set(requestId, cb);
            mt.postMessage({
              ...requestSerialized,
              body: requestSerialized.body ? requestSerialized.body.toString() : null,
            });
          } catch (err) {
            log("sw fetch error: %o", err);
          }
        });
      }),
      new Promise<Response>((resolve) => {
        if (!isLongPolling(requestUrl)) {
          timeoutResponse = setTimeout(() => {
            timeoutResponse = null;
            const eventCbs: string[] = [];
            this.forEach((cb, id) => {
              assert("eventId" in cb, "fakettp: missing eventId in cb");
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
      new Promise<Response>((resolve) => {
        abortedResponse = () => {
          resolve(
            new Response(null, {
              statusText: "Service Unavailable",
              status: 503,
            })
          );
        };
        emitter.once("self-destruct", abortedResponse);
      }),
    ]).finally(() => {
      if (timeoutResponse) {
        clearTimeout(timeoutResponse);
        timeoutResponse = null;
      }
      if (abortedResponse) {
        emitter.off("self-destruct", abortedResponse);
      }
    })
  );

  ev.respondWith(work);
}

function onMessage(this: Listeners, event: MessageEvent<SerializedResponse | object>) {
  if ("id" in event.data && this.has(event.data.id)) {
    log("got fetch response event: %o", event.data);
    const messageListener = this.get(event.data.id);
    messageListener(event.data);
  } else {
    log("got RPC event: %o", event.data);
    emitter.emit("message", event.data);
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

export type Listeners = Map<string, (event: SerializedResponse) => void>;

function buildConfigFromLocation(): FullConfig {
  const locationConfig = getConfigFromLocation();
  return {
    include: locationConfig.include.map((i) => new RegExp(i)),
    exclude: locationConfig.exclude.map((e) => new RegExp(e)),
  };
}

const CONFIG = new Singleton(buildConfigFromLocation);

const getConfig = () => CONFIG.Get();

export function installProxyWorker() {
  log("install proxy worker");
  assert(isRunningInServiceWorker(), "fakettp: createProxyClient != sw.");
  const listeners: Listeners = new Map();
  globalThis.addEventListener("fetch", onFetch.bind(listeners));
  globalThis.addEventListener("message", onMessage.bind(listeners));
  globalThis.addEventListener("install", onInstall);
  globalThis.addEventListener("activate", onActivate);
  setContext({
    postMessage: (data) => {
      getClients().then((clients) => {
        clients.forEach((client) => {
          client.postMessage(data);
        });
      });
    },
    recvMessage: (cb) => {
      emitter.on("message", cb);
      return () => {
        emitter.off("message", cb);
      };
    },
  });
}
