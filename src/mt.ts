declare const globalThis: Window;

import debug from "debug";
import assert from "assert";
import { EventEmitter } from "events";
import type { RequestListener } from "http";
import { Writable, Duplex, Readable } from "stream";
import {
  FIN,
  uniqueId,
  defaultHost,
  defaultPort,
  normalizedPort,
  SerializedRequest,
  SerializedResponse,
  deserializeRequest,
  isRunningInBrowserWindow,
  getBundledWorkerFileName,
} from "./common";

const nosup = (..._unused: any[]) => assert(false, "fakettp: not supported.");
const canRequestHaveBody = (method: string) => method !== "GET" && method !== "HEAD";

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
  readonly remoteAddress: string;
  readonly remoteFamily: string;
  readonly remotePort: string;

  constructor(readonly incomingRequest: Request, public readonly ports: SocketPorts) {
    super();
    log("creating socket: %d", this.id);
    ports.responsePort.start();
    ports.requestPort?.start();
    if (this.ports.requestPort && canRequestHaveBody(incomingRequest.method)) {
      this.ports.requestPort.onmessage = (event: MessageEvent<ArrayBufferView | typeof FIN>) => {
        if (event.data === FIN) {
          log("request port received FIN: %d", this.id);
          this.push(null);
        } else {
          log("request port received data: %d", this.id);
          this.push(event.data);
        }
      };
    }
    this.remoteAddress = this._getRemoteAddress();
    this.remoteFamily = this._getRemoteFamily();
    this.remotePort = this._getRemotePort();
  }
  private _getRemoteAddress() {
    const _url = new URL(this.incomingRequest.url || globalThis.location.href);
    return _url.hostname;
  }
  private _getRemoteFamily() {
    return "IPv4";
  }
  private _getRemotePort() {
    const _url = new URL(this.incomingRequest.url || globalThis.location.href);
    return normalizedPort(_url);
  }
  _destroy(error?: Error, callback?: (error?: Error) => void): void {
    log("destroying socket: %d", this.id);
    this.ports.responsePort.close();
    this.ports.requestPort?.close();
    callback?.(error);
  }
  _write(data: any, encoding?: BufferEncoding, callback?: (error?: Error) => void): void {
    log("writing to socket: %d with encoding", this.id, encoding);
    assert("buffer" in data);
    this.ports.responsePort.postMessage(data, [data.buffer]);
    callback?.();
  }
  _read(size: number): void {
    if (canRequestHaveBody(this.incomingRequest.method)) {
      log("reading from socket: %d", this.id);
      this.ports.requestPort?.postMessage(size);
    } else {
      log("socket cannot have more data: %d", this.id);
      this.push(null);
    }
  }
}

export class ServerResponse extends Writable {
  finished = false;
  statusCode = 200;
  headersSent = false;
  statusMessage = "OK";
  private readonly _headers = new Headers();
  sendDate = nosup;
  setTimeout = nosup;
  addTrailers = nosup;
  writeContinue = nosup;
  readonly remoteAddress: string;
  readonly remoteFamily: string;
  readonly remotePort: string;
  constructor(readonly incomingRequest: Request, public readonly socket: Socket) {
    super();
    this.once("finish", () => {
      log("server response finished");
      this.finished = true;
    });
    this.remoteAddress = this._getRemoteAddress();
    this.remoteFamily = this._getRemoteFamily();
    this.remotePort = this._getRemotePort();
  }
  _final(callback: (error?: Error) => void): void {
    log("finalizing server response");
    this.socket.write(FIN, () => {
      this.socket.end(callback);
    });
  }
  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error) => void): void {
    log("writing to server response");
    this.socket.write(chunk, encoding, callback);
  }
  // https://github.com/expressjs/session/pull/908/files
  get _header() {
    log("deprecated _header for server response");
    return !!this.headersSent;
  }
  // https://github.com/expressjs/session/pull/908/files
  _implicitHeader() {
    log("deprecated _implicitHeader for server response");
    this.writeHead(this.statusCode, this.statusMessage, this.getHeaders());
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
  private _getRemoteAddress() {
    const _url = new URL(this.incomingRequest.url || globalThis.location.href);
    return _url.hostname;
  }
  private _getRemoteFamily() {
    return "IPv4";
  }
  private _getRemotePort() {
    const _url = new URL(this.incomingRequest.url || globalThis.location.href);
    return normalizedPort(_url);
  }
}

export class IncomingMessage extends Readable {
  readonly headers: Record<string, string>;
  readonly rawHeaders: Record<string, string>;
  readonly method: string;
  readonly url: string;
  readonly connection: Socket;
  complete = false;
  setTimeout = nosup;
  constructor(readonly incomingRequest: Request, readonly socket: Socket) {
    super();
    this.complete = !canRequestHaveBody(incomingRequest.method);
    this.socket.once("end", () => {
      log("incoming message completed");
      this.complete = true;
      this.push(null);
    });
    this.socket.on("data", (chunk: any) => {
      log("data received in incoming message from socket: %d", this.socket.id);
      this.push(chunk);
    });
    this.headers = this._getHeaders();
    this.rawHeaders = this._getRawHeaders();
    this.method = this._getMethod();
    this.url = this._getUrl();
    this.connection = this._getConnection();
  }
  _read(size: number): void {
    if (this.complete) {
      log("incoming message does not have data: %d", this.socket.id);
      return;
    } else {
      log("incoming message needs data: %d", this.socket.id);
      this.socket.read(size);
    }
  }
  readonly httpVersion = "1.1";
  readonly trailers = {};
  readonly rawTrailers = {};

  private _getHeaders() {
    const headers: Record<string, string> = {};
    this.incomingRequest.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  }
  private _getRawHeaders() {
    const headers: Record<string, string> = {};
    this.incomingRequest.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }
  private _getMethod() {
    return this.incomingRequest.method;
  }
  private _getUrl() {
    const _url = new URL(this.incomingRequest.url);
    return `${_url.pathname}${_url.search}${_url.hash}`;
  }
  private _getConnection() {
    return this.socket;
  }
  readonly statusCode = 200;
  readonly statusMessage = "OK";
}

class Server extends EventEmitter {
  private _host = defaultHost;
  private _port = +defaultPort;
  private _listening = false;
  constructor() {
    log("creating fakettp server");
    assert(isRunningInBrowserWindow(), "fakettp: Server must be created in main thread.");
    assert("serviceWorker" in navigator, "fakettp: ServiceWorkers are not supported.");
    super();
  }
  address() {
    const { _host, _port } = this;
    return {
      get address() {
        return _host;
      },
      get port() {
        return _port;
      },
      get family() {
        return "IPv4";
      },
      toString() {
        return `${this.address}:${this.port}`;
      },
    };
  }
  get listening() {
    return this._listening;
  }
  listen(port?: number, hostname?: string, listeningListener?: () => void): this;
  listen(port?: number, listeningListener?: () => void): this;
  listen(
    options: {
      port?: number | undefined;
      host?: string | undefined;
    },
    listeningListener?: () => void
  ): this;
  listen(...args: any[]) {
    if (typeof args[0] === "number") {
      this._port = args[0];
      if (typeof args[1] === "string") {
        this._host = args[1];
      }
    }
    if (typeof args[0] === "object") {
      this._port = args[0].port || this._port;
      this._host = args[0].host || this._host;
    }
    log("listening on address: %o", this.address());
    const _last = args.pop();
    const _done = typeof _last === "function" ? (_last as (error?: Error) => void) : () => {};
    this.once("error", _done);
    this.once("listening", _done);
    if (this._listening) {
      log("already listening");
      const error = new Error("Already listening.");
      this.emit("error", error);
    } else {
      log("starting to believe...");
      reload()
        .then(() => getWorker())
        .then(() => {
          this._listening = true;
          log("service worker ready");
          this.once("close", () => {
            log("closing service worker");
            this._listening = false;
            unload();
          });
          this.emit("listening");
          navigator.serviceWorker.addEventListener("message", (event: MessageEvent<SerializedRequest>) => {
            log("message received from service worker");
            const responseChannel = new MessageChannel();
            const responsePort = responseChannel.port1;
            const requestPort = event.ports[0];
            const request = deserializeRequest(event.data);
            const socket = new Socket(request, { responsePort, requestPort });
            this.emit("connection", socket);
            const message = new IncomingMessage(request, socket);
            const response = new ServerResponse(request, socket);
            const _wrapUp = () => {
              if (response.headersSent) return;
              log("closing request stream");
              response.headersSent = true;
              log("responding to service worker");
              event.source.postMessage(
                {
                  id: request.id,
                  status: response.statusCode,
                  statusText: response.statusMessage,
                  headers: response.getHeaders(),
                } as SerializedResponse,
                {
                  transfer: [responseChannel.port2],
                  targetOrigin: event.origin,
                }
              );
            };
            response.once("finish", () => {
              if (message.complete) _wrapUp();
              else message.once("end", _wrapUp);
            });
            if (this.listenerCount("request") === 0) {
              response.writeHead(418, "I'm a teapot");
              response.end();
            } else {
              this.emit("request", message, response);
            }
          });
        });
    }
    return this;
  }
  close(callback?: (error?: Error) => void) {
    unload()
      .then(() => callback?.(undefined))
      .catch(callback)
      .finally(() => this.emit("close"));
    return this;
  }
}

async function getWorker() {
  return await navigator.serviceWorker.ready.then((registration) => {
    return registration.active || registration.installing || registration.waiting;
  });
}

export async function reload() {
  navigator.serviceWorker.register(getBundledWorkerFileName());
  await waitForWorkerLoad();
}

export async function unload() {
  navigator.serviceWorker.ready.then((r) => r.unregister());
  navigator.serviceWorker.register("nosw.js");
  await waitForWorkerStop();
}

async function waitForWorkerStop() {
  while (true) {
    try {
      const response = await fetch(`/__status__`);
      if (response.status !== 200) break;
    } catch (error) {
      log("error fetching /__status__: %o", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForWorkerLoad() {
  while (true) {
    try {
      const response = await fetch(`/__status__`);
      if (response.status === 200) break;
    } catch (error) {
      log("error fetching /__status__: %o", error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function createProxyServer(requestListener?: RequestListener): Server {
  const server = new Server();
  if (requestListener) server.on("request", requestListener);
  return server;
}
