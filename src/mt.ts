import debug from "debug";
import assert from "assert";
import { EventEmitter } from "events";
import type { RequestListener } from "http";
import { Writable, Duplex, Readable } from "stream";

import { getContext } from "./context";
import { MessageChannel, MessagePort } from "./channel";
import {
  FIN,
  uniqueId,
  defaultUrl,
  defaultHost,
  defaultPort,
  normalizedPort,
  SerializedRequest,
  SerializedResponse,
  deserializeRequest,
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
    log("creating socket: %s", this.id);
    ports.responsePort.start();
    ports.requestPort?.start();
    if (this.ports.requestPort && canRequestHaveBody(incomingRequest.method)) {
      this.ports.requestPort.onmessage = (data: ArrayBufferView | typeof FIN) => {
        if (data === FIN) {
          log("request port received FIN: %s", this.id);
          this.push(null);
        } else {
          log("request port received data: %s", this.id);
          this.push(data);
        }
      };
    }
    this.remoteAddress = this._getRemoteAddress();
    this.remoteFamily = this._getRemoteFamily();
    this.remotePort = this._getRemotePort();
  }
  private _getRemoteAddress() {
    const _url = new URL(this.incomingRequest.url || defaultUrl().href);
    return _url.hostname;
  }
  private _getRemoteFamily() {
    return "IPv4";
  }
  private _getRemotePort() {
    const _url = new URL(this.incomingRequest.url || defaultUrl().href);
    return normalizedPort(_url);
  }
  _destroy(error?: Error, callback?: (error?: Error) => void): void {
    log("destroying socket: %s", this.id);
    this.ports.responsePort.close();
    this.ports.requestPort?.close();
    callback?.(error);
  }
  _write(data: any, encoding?: BufferEncoding, callback?: (error?: Error) => void): void {
    log("writing to socket: %s with encoding", this.id, encoding);
    assert("buffer" in data, "fakettp: data must be a buffer");
    this.ports.responsePort.postMessage(data);
    callback?.();
  }
  _read(size: number): void {
    if (canRequestHaveBody(this.incomingRequest.method)) {
      log("reading from socket: %s", this.id);
      this.ports.requestPort?.postMessage(size);
    } else {
      log("socket cannot have more data: %s", this.id);
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
    // log("deprecated _header for server response"); // too much log spam
    return !!this.headersSent;
  }
  // https://github.com/expressjs/session/pull/908/files
  _implicitHeader() {
    // log("deprecated _implicitHeader for server response"); // too much log spam
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
    const _url = new URL(this.incomingRequest.url || defaultUrl().href);
    return _url.hostname;
  }
  private _getRemoteFamily() {
    return "IPv4";
  }
  private _getRemotePort() {
    const _url = new URL(this.incomingRequest.url || defaultUrl().href);
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
      log("data received in incoming message from socket: %s", this.socket.id);
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
      log("incoming message does not have data: %s", this.socket.id);
      return;
    } else {
      log("incoming message needs data: %s", this.socket.id);
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
  private _host = defaultHost();
  private _port = +defaultPort();
  private _dispose: Function | null = null;
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
      toJSON() {
        return this.toString();
      },
    };
  }
  get listening() {
    return this._dispose !== null;
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
    log("listening on address: %s", JSON.stringify(this.address()));
    const _last = args.pop();
    const _done = typeof _last === "function" ? (_last as (error?: Error) => void) : () => {};
    this.once("error", _done);
    this.once("listening", _done);
    if (this.listening) {
      log("already listening");
      const error = new Error("Already listening.");
      this.emit("error", error);
    } else {
      log("starting to believe...");
      reload()
        .then(getContext)
        .then((ctx) => {
          log("service worker ready");
          this.once("close", () => {
            log("closing service worker");
            this._dispose?.();
            this._dispose = null;
            unload();
          });
          this.emit("listening");
          this._dispose = ctx.readMessages((event: SerializedRequest) => {
            if (!("id" in event && "body" in event && "url" in event)) return;
            log("message received from service worker: %o", event);
            const responseChannel = new MessageChannel();
            const responsePort = responseChannel.port1;
            const requestPort = new MessagePort(event.body as unknown as string);
            const request = deserializeRequest(event);
            const socket = new Socket(request, { responsePort, requestPort });
            this.emit("connection", socket);
            const message = new IncomingMessage(request, socket);
            const response = new ServerResponse(request, socket);
            const _wrapUp = () => {
              if (response.headersSent) return;
              log("closing request stream");
              response.headersSent = true;
              log("responding to service worker");
              const payload: SerializedResponse = {
                id: request.id,
                body: responseChannel.port2.toString(),
                status: response.statusCode,
                statusText: response.statusMessage,
                headers: response.getHeaders(),
              };
              ctx.postMessage(payload);
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

async function reload() {
  await getContext().reloadWorker?.();
}

async function unload() {
  await getContext().unloadWorker?.();
}

export function createProxyServer(requestListener?: RequestListener): Server {
  const server = new Server();
  if (requestListener) server.on("request", requestListener);
  return server;
}
