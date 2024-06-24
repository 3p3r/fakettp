import debug from "debug";
import assert from "assert";
import traverse from "traverse";
import { EventEmitter } from "events";
import { RPC } from "@mixer/postmessage-rpc";
import { uniqueId, threadId, timedPromise } from "./common";
import { getContext } from "./context";

const POST_PREFIX = "port";
const POST_TIMEOUT = 10000;

const _log = debug("fakettp:channel");
const log = (patt: string, ...args: any[]) => _log(`[${threadId()}] ${patt}`, ...args);

interface TransferredBuffer {
  data: number[];
  type: "Buffer";
}

function isTransferredBuffer(input: any): input is TransferredBuffer {
  return typeof input === "object" && Array.isArray(input.data) && input.type === "Buffer";
}

function correctTransferredBuffer(input: any) {
  return traverse(input).map(function (value) {
    if (isTransferredBuffer(value)) {
      this.update(new Uint8Array(value.data));
    }
  });
}

export class MessagePort<T extends object = any> extends EventEmitter {
  private _started = false;
  private _stopped = false;
  private _posting = false;
  private readonly _q: T[] = [];
  private readonly _rpc: RPC;
  constructor(readonly id = uniqueId(), readonly context = getContext()) {
    super();
    this.setMaxListeners(0); // fixme
    this.id = (id || uniqueId()).replace(new RegExp(`^${POST_PREFIX}:`), "");
    this._rpc = new RPC({
      serviceId: this.id,
      target: this.context,
      receiver: this.context,
    });
    this._rpc.expose("emit", (message: T) => {
      log("message received: %o", message);
      if (this._started) this.emit("message", correctTransferredBuffer(message));
      else this._q.push(correctTransferredBuffer(message));
    });
  }
  set onmessage(value: (this: MessagePort<T>, message: T) => any) {
    this.on("message", value);
    this.start();
  }
  close(): void {
    if (this._stopped) return;
    if (this._posting) {
      this.once("unblocked", this.close.bind(this));
      return;
    }
    this._stopped = true;
    this._rpc.destroy();
    this.emit("close");
    this.removeAllListeners();
    log("port closed: %s", this.id);
  }
  async postMessage<R = unknown>(message: T) {
    this._posting = true;
    await timedPromise(
      POST_TIMEOUT,
      this._rpc.isReady,
      `port ${this.id} failed to connect (msg: '${JSON.stringify(message)}').`
    );
    log("message sent: %o", message);
    const ret = await this._rpc.call<R>("emit", message, true);
    this._posting = false;
    this.emit("unblocked");
    return ret;
  }
  start(): void {
    if (this._started) return;
    this._started = true;
    for (const message of this._q) {
      this.emit("message", message);
    }
  }
  addEventListener(type: string, listener: (this: MessagePort<T>, ev: T) => any): void {
    this.on(type, listener);
  }
  removeEventListener(type: string, listener: (this: MessagePort<T>, ev: T) => any): void {
    this.off(type, listener);
  }
  dispatchEvent = (): boolean => {
    assert(false, "dispatchEvent not supported. use postMessage instead.");
  };
  toString(): string {
    return `${POST_PREFIX}:${this.id}`;
  }
  toJSON(): string {
    return this.toString();
  }
}

export class MessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;

  constructor(context = getContext()) {
    this.port1 = new MessagePort(uniqueId(), context);
    this.port2 = new MessagePort(uniqueId(), context);
    const _port1PostMessage = this.port1.postMessage.bind(this.port1);
    const _port2PostMessage = this.port2.postMessage.bind(this.port2);
    this.port1.postMessage = _port2PostMessage;
    this.port2.postMessage = _port1PostMessage;
    const port2OnMessage = (message: any) => {
      this.port1
        .listeners("message")
        .filter((listener) => listener !== port1OnMessage)
        .forEach((listener) => {
          listener.call(this.port1, correctTransferredBuffer(message));
        });
    };
    const port1OnMessage = (message: any) => {
      this.port2
        .listeners("message")
        .filter((listener) => listener !== port2OnMessage)
        .forEach((listener) => {
          listener.call(this.port2, correctTransferredBuffer(message));
        });
    };
    this.port1.onmessage = port1OnMessage;
    this.port2.onmessage = port2OnMessage;
  }
}
