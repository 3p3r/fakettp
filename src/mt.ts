import debug from "debug";
import assert from "assert";
import { EventEmitter } from "events";
import type { RequestListener } from "http";
import { Writable, Duplex, Readable } from "stream";
import {
  ARM,
  FIN,
  uniqueId,
  SerializedRequest,
  SerializedResponse,
  deserializeRequest,
  isRunningInMainThread,
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
  constructor(readonly incomingRequest: Request, public readonly socket: Socket) {
    super();
    this.once("finish", () => {
      log("server response finished");
      this.finished = true;
    });
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
  get remoteAddress() {
    const _url = new URL(this.incomingRequest.url);
    return _url.hostname;
  }
  get remoteFamily() {
    return "IPv4";
  }
  get remotePort() {
    const _url = new URL(this.incomingRequest.url);
    return _url.port || _url.protocol === "https:" ? "443" : "80";
  }
}

export class IncomingMessage extends Readable {
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
    const _url = new URL(this.incomingRequest.url);
    return `${_url.pathname}${_url.search}${_url.hash}`;
  }
  get connection() {
    return this.socket;
  }
  readonly statusCode = 200;
  readonly statusMessage = "OK";
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
    return Server.registrations.length > 0;
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
    if (Server.registrations.length > 0) {
      log("already listening");
      const error = new Error("Already listening.");
      this.emit("error", error);
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
        });
      navigator.serviceWorker.ready.then((registration) => {
        Server.registrations.push(registration);
        log("service worker ready");
        arm(this._host, this._port, this._addresses);
        let proxy = true;
        const fixBrowsersThatLackCorrectTiming = 100;
        setTimeout(() => this.emit("listening"), fixBrowsersThatLackCorrectTiming);
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
                proxy,
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
    disarm();
    callback?.();
    return this;
  }
}

export function createProxyServer(requestListener?: RequestListener, addresses?: Map<string, string>): Server {
  const server = new Server(addresses);
  if (requestListener) server.on("request", requestListener);
  return server;
}

function disarm() {
  log("disarming service worker");
  navigator.serviceWorker.getRegistration(getBundledWorkerFileName()).then((registration) => {
    registration?.active?.postMessage(FIN);
  });
  for (const registration of Server.registrations) {
    registration.unregister();
  }
  Server.registrations.length = 0;
}

function arm(host: string, port: number, addresses: Map<string, string>) {
  log("arming service worker");
  navigator.serviceWorker.getRegistration(getBundledWorkerFileName()).then((registration) => {
    addresses.set(host, port.toString());
    registration?.active?.postMessage(addresses);
    registration?.active?.postMessage(ARM);
  });
}

if (isRunningInMainThread()) disarm();
