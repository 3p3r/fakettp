import debug from "debug";
import { v4 as uuid } from "uuid";

import { MessageChannel, MessagePort } from "./channel";

const LOG = debug("fakettp:common");
const log = (patt: string, ...args: any[]) => LOG(`[${threadId()}] ${patt}`, ...args);

export const FIN = "\x00" as const;

export function isRunningInServiceWorker() {
  return typeof globalThis !== "undefined" && "ServiceWorkerGlobalScope" in globalThis;
}

export type StringOrBuffer = string | ArrayBufferView;

export function StringOrBufferToBuffer(input: StringOrBuffer) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (ArrayBuffer.isView(input)) return input;
}

export function StringOrBufferToString(input: StringOrBuffer) {
  if (typeof input === "string") return input;
  if (ArrayBuffer.isView(input)) return new TextDecoder().decode(input);
}

export const uniqueId = () => uuid();

export function MessagePortToReadableStream(port: MessagePort): ReadableStream<ArrayBufferView> {
  const portId = uniqueId();
  log("creating readable stream from message port: %s", portId);
  let controller: ReadableStreamController<ArrayBufferView> | null = null;
  port.onmessage = function (data: StringOrBuffer | typeof FIN) {
    log("message received from message port: %s", portId);
    if (StringOrBufferToString(data) === FIN) {
      log("fin received from message port for readable stream: %s", portId);
      try {
        controller?.close();
      } catch (e) {
        log(e);
      }
      controller = null;
      port.close();
    } else {
      log("pushing data to readable stream from message port: %s", portId);
      const content = StringOrBufferToBuffer(data);
      controller?.enqueue(content);
    }
  };
  return new ReadableStream<ArrayBufferView>({
    type: "bytes",
    start(ctrl) {
      log("controller started for readable stream from message port: %s", portId);
      controller = ctrl;
    },
  });
}

export function ReadableStreamToMessagePort(stream: ReadableStream<StringOrBuffer>): MessagePort {
  const channel = new MessageChannel();
  const portId = uniqueId();
  const port = channel.port1;
  log("creating message port from readable stream: %s", portId);
  stream.pipeTo(
    new WritableStream<StringOrBuffer>({
      write(data) {
        log("pushing data from readable stream to message port: %s", portId);
        const content = StringOrBufferToBuffer(data);
        port.postMessage(content);
      },
      close() {
        log("fin received from stream for message port: %s", portId);
        port.postMessage(FIN);
        channel.port1.close();
      },
    })
  );
  return channel.port2;
}

export async function RequestBodyToReadableStream(request: Request): Promise<ReadableStream> {
  const clone = request.clone();
  if (clone.body) return clone.body;
  if (clone.bodyUsed) return new ReadableStream();
  return (
    await Promise.all([
      clone.blob().then((b) => b && b.stream()),
      clone.text().then((t) => t && new Blob([t], { type: "text/plain" }).stream()),
      clone.arrayBuffer().then((b) => b && new Blob([b], { type: "application/octet-stream" }).stream()),
    ])
  ).filter(Boolean)?.[0];
}

export type SerializedResponse = ResponseInit & { id: string; body: string };
export type SerializedRequest = Awaited<ReturnType<typeof serializeRequest>>;

export async function serializeRequest(request: Request) {
  const id = uniqueId();
  log("serializing request: %s", id);
  const url = request.url;
  const method = request.method;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const mode = request.mode;
  const body =
    method === "GET" || method === "HEAD"
      ? null
      : ReadableStreamToMessagePort(await RequestBodyToReadableStream(request));
  const credentials = request.credentials;
  const cache = request.cache;
  const redirect = request.redirect;
  const referrer = request.referrer;
  const referrerPolicy = request.referrerPolicy;
  const integrity = request.integrity;
  const keepalive = request.keepalive || false;
  return {
    id,
    url,
    method,
    headers,
    body,
    mode,
    credentials,
    cache,
    redirect,
    referrer,
    referrerPolicy,
    integrity,
    keepalive,
  };
}

export function deserializeRequest(request: SerializedRequest): Request & { id?: string } {
  const {
    id,
    url,
    method,
    headers,
    body,
    mode,
    credentials,
    cache,
    redirect,
    referrer,
    referrerPolicy,
    integrity,
    keepalive,
  } = request;
  log("deserializing request: %s", id);
  const requestInit: RequestInit = {};
  Object.assign(requestInit, { duplex: "half" });
  if (method) requestInit.method = method;
  if (headers) requestInit.headers = new Headers(headers);
  if (body) requestInit.body = MessagePortToReadableStream(new MessagePort(body as unknown as string));
  if (mode) requestInit.mode = mode === "navigate" ? undefined : mode;
  if (credentials) requestInit.credentials = credentials;
  if (cache) requestInit.cache = cache;
  if (redirect) requestInit.redirect = redirect;
  if (referrer) requestInit.referrer = referrer;
  if (referrerPolicy) requestInit.referrerPolicy = referrerPolicy;
  if (integrity) requestInit.integrity = integrity;
  if (keepalive) requestInit.keepalive = keepalive;
  const ret = new Request(url, requestInit);
  if (id !== undefined) Object.assign(ret, { id });
  return ret;
}

export function normalizedPort(url: URL) {
  return url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
}

export function defaultUrl() {
  if (typeof globalThis !== "undefined" && "location" in globalThis) {
    return new URL(globalThis.location.href);
  } else {
    log("defaultURL: globalThis.location not found.");
    return new URL("http://localhost");
  }
}

export function defaultHost() {
  const _url = defaultUrl();
  return _url.hostname;
}

export function defaultPort() {
  const _url = defaultUrl();
  return normalizedPort(_url);
}

export class Singleton<T> {
  private _instance: T | null = null;
  private _factory: () => T;
  constructor(factory: () => T) {
    this._factory = factory;
  }
  Get() {
    if (this._instance === null) {
      this._instance = this._factory();
    }
    return this._instance;
  }
}

const THREAD_ID = new Singleton(() => {
  const _id = uniqueId();
  return `${_id.slice(0, 3)}${_id.slice(-3)}`;
});

export function threadId() {
  return THREAD_ID.Get();
}

export function timedPromise<T>(ms: number, promise: Promise<T>, message = "Timed out") {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

export interface PartConfig {
  readonly include?: string[];
  readonly exclude?: string[];
}

export interface FullConfig {
  readonly include: RegExp[];
  readonly exclude: RegExp[];
}

const DEFAULT_CONFIG: Required<PartConfig> = {
  exclude: ["fakettp\\.js", "nosw\\.js$", "favicon\\.ico$"],
  include: [".*"],
};

export function getConfigFromLocation(): Required<PartConfig> {
  if (typeof globalThis !== "object" || !("location" in globalThis)) {
    log("location object not found");
    return DEFAULT_CONFIG;
  }
  log("checking for location config: %o", globalThis.location);
  const search = new URLSearchParams(globalThis.location.search);
  const include = search.getAll("i");
  const exclude = search.getAll("e");
  if (include.length === 0 && exclude.length === 0) {
    log("no location config found, using defaults");
    return DEFAULT_CONFIG;
  }
  const out = { include, exclude };
  log("location config: %o", out);
  return out;
}
