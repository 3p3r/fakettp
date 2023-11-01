import debug from "debug";
import { EventEmitter } from "events";
import type { RequestListener } from "http";
import { Writable, Duplex, Readable } from "stream";
import {
  ARM,
  FIN,
  assert,
  uniqueId,
  SerializedRequest,
  SerializedResponse,
  deserializeRequest,
  isRunningInMainThread,
  getBundledWorkerFileName,
} from "./common";

const nosup = (..._unused: any[]) => assert(false, "fakettp: not supported.");

const log = debug("fakettp:mt");

interface SocketPorts {
  readonly responsePort: MessagePort;
  readonly requestPort?: MessagePort;
}

class Socket extends Duplex {
  connect = nosup;
  setTimeout = nosup;
  setNoDelay = nosup;
  setKeepAlive = nosup;
  readonly id = uniqueId();
  constructor(public readonly ports: SocketPorts) {
    super();
    log("creating socket: %d", this.id);
    ports.responsePort.start();
    ports.requestPort?.start();
    if (this.ports.requestPort) {
      this.ports.requestPort.onmessage = (event: MessageEvent<ArrayBufferView | typeof FIN>) => {
        if (event.data === FIN) {
          log("request port received FIN: %d", this.id);
          this.emit("req:end");
        } else {
          log("request port received data: %d", this.id);
          this.push(event.data);
        }
      };
    }
  }
  _destroy(error?: Error, callback?: (error?: Error) => void): void {
    log("destroying socket: %d", this.id);
    this.ports.responsePort.close();
    this.ports.requestPort?.close();
    callback?.(error);
  }
  _write(data: any, encoding?: BufferEncoding, callback?: (error?: Error) => void): void {
    log("writing to socket: %d", this.id);
    assert("buffer" in data);
    this.ports.responsePort.postMessage(data, [data.buffer]);
    callback?.();
  }
  _read(size: number): void {
    log("reading from socket: %d", this.id);
    this.ports.requestPort?.postMessage(size);
  }
}

class ServerResponse extends Writable {
  statusCode = 418;
  headersSent = false;
  statusMessage = "I'm a teapot";
  private readonly _headers = new Headers();
  sendDate = nosup;
  setTimeout = nosup;
  addTrailers = nosup;
  writeContinue = nosup;
  constructor(public readonly socket: Socket) {
    super();
  }
  _final(callback: (error?: Error) => void): void {
    log("finalizing server response");
    this.socket.write(FIN, callback);
    this.socket.end(callback);
  }
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error) => void): void {
    log("writing to server response");
    this.socket.write(chunk, encoding, callback);
  }
  writeHead(statusCode: number, statusMessage?: string, headers?: Record<string, string>) {
    log("writing head to server response");
    this.statusCode = statusCode;
    if (statusMessage) this.statusMessage = statusMessage;
    if (headers) {
      for (const name in headers) {
        this.setHeader(name, headers[name]);
      }
    }
  }
  getHeaders() {
    const headers: Record<string, string> = {};
    this._headers.forEach((value: string, key: string) => {
      headers[key] = value;
    });
    return headers;
  }
  getHeader(name: string) {
    return this._headers.get(name);
  }
  getHeaderNames() {
    const names: string[] = [];
    this._headers.forEach((_: string, name: string) => names.push(name));
    return names;
  }
  hasHeader(name: string) {
    return this._headers.has(name);
  }
  setHeader(name: string, value: string) {
    this._headers.set(name, value);
  }
  removeHeader(name: string) {
    this._headers.delete(name);
  }
  flushHeaders() {
    for (const name of this.getHeaderNames()) {
      this._headers.delete(name);
    }
  }
}

class IncomingMessage extends Readable {
  setTimeout = nosup;
  constructor(readonly incomingRequest: Request, readonly socket: Socket) {
    super();
    this.socket.on("data", (chunk: any) => {
      log("data received in incoming message from socket: %d", this.socket.id);
      this.push(chunk);
    });
  }
  _read(size: number): void {
    log("incoming message needs data: %d", this.socket.id);
    this.socket.read(size);
  }
  get httpVersion() {
    return "1.1";
  }
  get trailers() {
    return {};
  }
  get rawTrailers() {
    return {};
  }
  get headers() {
    const headers: Record<string, string> = {};
    this.incomingRequest.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  }
  get rawHeaders() {
    const headers: Record<string, string> = {};
    this.incomingRequest.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  get method() {
    return this.incomingRequest.method;
  }
  get url() {
    return this.incomingRequest.url;
  }
  get statusCode() {
    return 200;
  }
  get statusMessage() {
    return "OK";
  }
}

class Server extends EventEmitter {
  static registrations: ServiceWorkerRegistration[] = [];
  private _host = self.location.hostname;
  private _port = +self.location.port;
  constructor(private readonly _addresses: Map<string, string> = new Map()) {
    log("creating fakettp server");
    assert(isRunningInMainThread(), "fakettp: Server must be created in main thread.");
    assert("serviceWorker" in navigator, "fakettp: ServiceWorkers are not supported.");
    super();
  }
  address() {
    return {
      get address() {
        return this._host;
      },
      get port() {
        return this._port;
      },
      get family() {
        return "IPv4";
      },
    };
  }
  get listening() {
    return Server.registrations.length > 0;
  }
  listen(...args: any[]) {
    if (typeof args[0] === "number") {
      this._port = args[0];
      if (typeof args[1] === "string") {
        this._host = args[1];
      }
    }
    log("listening on address: %o", this.address());
    const _last = args.pop();
    const callback = typeof _last === "function" ? (_last as (error?: Error) => void) : () => {};
    if (Server.registrations.length > 0) {
      log("already listening");
      const error = new Error("Already listening.");
      this.emit("error", error);
      callback?.(error);
    } else {
      log("starting to believe...");
      navigator.serviceWorker
        .register(getBundledWorkerFileName())
        .then((registration) => {
          log("service worker registered");
          Server.registrations.push(registration);
        })
        .catch((error) => {
          log("service worker registration failed");
          this.emit("error", error);
          callback?.(error);
        });
      navigator.serviceWorker.ready.then((registration) => {
        Server.registrations.push(registration);
        log("service worker ready");
        arm(this._host, this._port, this._addresses);
        callback?.();
        let proxy = true;
        this.emit("listening");
        this.once("close", () => {
          log("closing service worker");
          registration.unregister();
          proxy = false;
        });
        navigator.serviceWorker.addEventListener("message", (event: MessageEvent<SerializedRequest>) => {
          log("message received from service worker");
          const responseChannel = new MessageChannel();
          const responsePort = responseChannel.port1;
          const requestPort = event.ports[0];
          const request = deserializeRequest(event.data);
          const socket = new Socket({ responsePort, requestPort });
          this.emit("connection", socket);
          const message = new IncomingMessage(request, socket);
          const response = new ServerResponse(socket);
          socket.once("req:end", () => {
            log("closing request stream");
            message.destroy();
            message.emit("end");
          });
          if (this.listenerCount("request") === 0) {
            response.end();
          } else {
            this.emit("request", message, response);
          }
          response.headersSent = true;
          log("responding to service worker");
          event.source.postMessage(
            {
              id: request.id,
              status: response.statusCode,
              statusText: response.statusMessage,
              headers: response.getHeaders(),
              proxy,
            } as SerializedResponse,
            {
              transfer: [responseChannel.port2],
              targetOrigin: event.origin,
            }
          );
        });
      });
    }
    return this;
  }
  close(callback?: (error?: Error) => void) {
    disarm();
    setTimeout(callback, 0);
    return this;
  }
}

export function createProxyServer(requestListener?: RequestListener, addresses?: Map<string, string>): Server {
  const server = new Server(addresses);
  if (requestListener) server.on("request", requestListener);
  return server;
}

function disarm() {
  navigator.serviceWorker.getRegistration(getBundledWorkerFileName()).then((registration) => {
    registration?.active?.postMessage(FIN);
  });
  for (const registration of Server.registrations) {
    registration.unregister();
  }
  Server.registrations.length = 0;
}

function arm(host: string, port: number, addresses: Map<string, string>) {
  navigator.serviceWorker.getRegistration(getBundledWorkerFileName()).then((registration) => {
    addresses.set(host, port.toString());
    registration?.active?.postMessage(addresses);
    registration?.active?.postMessage(ARM);
  });
}

if (isRunningInMainThread()) disarm();
