declare const globalThis: ServiceWorkerGlobalScope | Window;

import debug from "debug";

const log = debug("fakettp:sw");

export const FIN = "\x00" as const;

export function getBundledWorkerFileName() {
  return process.env.FAKETTP_MAIN || "fakettp.js";
}

export function getExcludedPaths() {
  const paths = [getBundledWorkerFileName()];
  return [
    ...paths,
    "nosw.js",
    "app.html",
    "favicon.ico",
    "auxillary.js",
    "inspector.js",
    "bundle.webgme.js",
    "bundle.memory.zip",
    "sample-express.js",
    "sample-express.html",
    "sample-express-static.js",
    "sample-express-static.html",
    "sample-socket-io.js",
    "sample-socket-io.html",
  ];
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

let counter = 0;
export const monotonicId = () => ++counter;
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
      try {
        controller?.close();
      } catch (e) {
        log(e);
      }
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

export type SerializedResponse = ResponseInit & { id: number };
export type SerializedRequest = Awaited<ReturnType<typeof serializeRequest>>;

export async function serializeRequest(request: Request) {
  const id = uniqueId();
  log("serializing request: %d", id);
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

export function deserializeRequest(request: SerializedRequest): Request & { id?: number } {
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
