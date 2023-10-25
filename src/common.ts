import debug from "debug";
import { EventEmitter } from "events";

const log = debug("fakettp:sw");

export const FIN = "\x00" as const;
export const ARM = "\x01" as const;

export function getBundledWorkerFileName() {
  return process.env.WEBPACK_FILENAME || "fakettp.js";
}

export function isRunningInMainThread() {
  return typeof window !== "undefined" && window === self;
}

export function isRunningInServiceWorker() {
  return typeof self !== "undefined" && "ServiceWorkerGlobalScope" in self;
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

export class Port extends EventEmitter {
  public readonly id = uniqueId();
  private readonly _ptr: WeakRef<MessagePort>;
  private _disconnected: boolean = false;
  constructor(port: MessagePort) {
    super();
    this._ptr = new WeakRef(port);
    port.onmessage = ({ data }) => this.emit("message", data);
    port.onmessageerror = ({ data }) => this.emit("error", data);
    port.start();
    this.once("close", () => {
      log("closing port: %d", this.id);
      this._disconnected = true;
    });
  }
  send<T>(data: T, transfer?: Transferable[]) {
    if (this._disconnected) {
      log("attempted to send data to disconnected port: %d", this.id);
      return;
    }
    const port = this._ptr.deref();
    if (!port) {
      this.emit("close");
      return;
    }
    try {
      log("sending data to port: %d", this.id);
      port.postMessage(data, transfer);
    } catch (error) {
      this.emit("error", error);
      this.emit("close");
    }
  }
}

export function MessagePortToReadableStream(messagePort: MessagePort): ReadableStream<ArrayBufferView> {
  const port = new Port(messagePort);
  log("creating readable stream from message port: %d", port.id);
  let controller: ReadableStreamController<ArrayBufferView> | null = null;
  port.on("message", function (data: StringOrBuffer | typeof FIN) {
    log("message received from message port: %d", port.id);
    if (StringOrBufferToString(data) === FIN) {
      log("fin received from message port for readable stream: %d", port.id);
      controller?.close();
      controller = null;
    } else {
      log("pushing data to readable stream from message port: %d", port.id);
      const content = StringOrBufferToBuffer(data);
      controller?.enqueue(content);
    }
  });
  port.once("close", () => {
    log("closing readable stream from message port: %d", port.id);
    controller?.enqueue(StringOrBufferToBuffer(FIN));
    controller?.close();
    controller = null;
  });
  return new ReadableStream<ArrayBufferView>({
    type: "bytes",
    start(ctrl) {
      log("controller started for readable stream from message port: %d", port.id);
      controller = ctrl;
    },
  });
}

export function ReadableStreamToMessagePort(stream: ReadableStream<StringOrBuffer>): MessagePort {
  const channel = new MessageChannel();
  const port = new Port(channel.port1);
  log("creating message port from readable stream: %d", port.id);
  const reader = stream.getReader();
  port.on("message", () => {
    log("message received from message port: %d", port.id);
    reader.read().then(function ({ done, value }) {
      const content = StringOrBufferToBuffer(value);
      if (content) {
        log("pushing data from readable stream to message port: %d", port.id);
        port.send(content, [content.buffer]);
      }
      if (done) {
        log("fin received from stream for message port: %d", port.id);
        port.send(FIN);
        channel.port1.close();
      }
    });
  });
  return channel.port2;
}

export type SerializedResponse = ResponseInit & { id: number; proxy: boolean };
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
  if (mode) requestInit.mode = mode;
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

export function assert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
