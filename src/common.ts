declare const globalThis: ServiceWorkerGlobalScope | Window;

import debug from "debug";

const log = debug("fakettp:sw");

export const FIN = "\x00" as const;
export const ARM = "\x01" as const;

export function getBundledWorkerFileName() {
  return process.env.WEBPACK_FILENAME || "fakettp.js";
}

export function isRunningInBrowserWindow() {
  return typeof window !== "undefined" && window === globalThis;
}

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

export const uniqueId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

export function MessagePortToReadableStream(port: MessagePort, onClose?: () => void): ReadableStream<ArrayBufferView> {
  const portId = uniqueId();
  log("creating readable stream from message port: %d", portId);
  let controller: ReadableStreamController<ArrayBufferView> | null = null;
  port.onmessage = function (event: MessageEvent<StringOrBuffer | typeof FIN>) {
    const { data } = event;
    log("message received from message port: %d", portId);
    if (StringOrBufferToString(data) === FIN) {
      log("fin received from message port for readable stream: %d", portId);
      controller?.close();
      controller = null;
      onClose?.();
    } else {
      log("pushing data to readable stream from message port: %d", portId);
      const content = StringOrBufferToBuffer(data);
      controller?.enqueue(content);
    }
  };
  return new ReadableStream<ArrayBufferView>({
    type: "bytes",
    start(ctrl) {
      log("controller started for readable stream from message port: %d", portId);
      controller = ctrl;
    },
  });
}

export function ReadableStreamToMessagePort(stream: ReadableStream<StringOrBuffer>, onClose?: () => void): MessagePort {
  const channel = new MessageChannel();
  const portId = uniqueId();
  const port = channel.port1;
  log("creating message port from readable stream: %d", portId);
  stream.pipeTo(
    new WritableStream<StringOrBuffer>({
      write(data) {
        log("pushing data from readable stream to message port: %d", portId);
        const content = StringOrBufferToBuffer(data);
        port.postMessage(content, [content.buffer]);
      },
      close() {
        log("fin received from stream for message port: %d", portId);
        port.postMessage(FIN);
        channel.port1.close();
        onClose?.();
      },
    })
  );
  return channel.port2;
}

export type SerializedResponse = ResponseInit & { id: number; };
export type SerializedRequest = ReturnType<typeof serializeRequest>;

export function serializeRequest(request: Request) {
  const id = uniqueId();
  log("serializing request: %d", id);
  const url = request.url;
  const method = request.method;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const mode = request.mode;
  const body = method === "GET" || method === "HEAD" ? null : ReadableStreamToMessagePort(request.body);
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

export function deserializeRequest(request: SerializedRequest): Request & { id?: number; } {
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
  log("deserializing request: %d", id);
  const requestInit: RequestInit = {};
  if (method) requestInit.method = method;
  if (headers) requestInit.headers = new Headers(headers);
  if (body) requestInit.body = MessagePortToReadableStream(body);
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

function _defaultHost() {
  const _url = new URL(globalThis.location.href);
  return _url.hostname;
}

function _defaultPort() {
  const _url = new URL(globalThis.location.href);
  return normalizedPort(_url);
}

export const defaultPort = _defaultPort();
export const defaultHost = _defaultHost();

interface ProxyInstanceEventTargetSW {
  readonly sw: ServiceWorkerGlobalScope;
  readonly mt: Promise<Client | null>;
  readonly listeners: Map<number, (event: MessageEvent<SerializedResponse>) => void>;
  host: string;
  port: string;
}

interface ProxyInstanceEventTargetMT {
  readonly sw: Promise<ServiceWorker | null>;
  readonly mt: Window;
}

type ProxyInstanceEventClients<T extends ServiceWorkerGlobalScope | Window> = T extends ServiceWorkerGlobalScope
  ? ProxyInstanceEventTargetSW
  : ProxyInstanceEventTargetMT;

interface ProxyInstanceCommon<T extends ServiceWorkerGlobalScope | Window> {
  readonly armed: boolean;
  arm(scope?: string): Promise<void>;
  disarm(): Promise<void>;
}

type ProxyInstance<T extends ServiceWorkerGlobalScope | Window> = ProxyInstanceCommon<T> & ProxyInstanceEventClients<T>;

export type ProxyWindowInstance = ProxyInstance<Window>;
export type ProxyWorkerInstance = ProxyInstance<ServiceWorkerGlobalScope>;

export class Singleton<T> {
  private instance: T | null = null;
  constructor(private readonly factory: () => T) { }
  get get() {
    if (this.instance === null) this.instance = this.factory();
    return this.instance;
  }
}
