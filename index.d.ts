/// <reference lib="dom" />
declare module "fakettp" {
  type CleanupReceiver = () => void | Promise<void>;
  type MessageReceiver = (message: any) => void | Promise<void>;
  export interface Context {
    readonly postMessage: MessageReceiver;
    readonly recvMessage: (callback: MessageReceiver) => CleanupReceiver;
    readonly reloadWorker?: () => void | Promise<void>;
    readonly unloadWorker?: () => void | Promise<void>;
  }
  export function setContext(context: Context): void;
  export function getContext(): Context;
  export class WindowContext implements Context {
    constructor(config?: { include?: RegExp[]; exclude?: RegExp[] });
    postMessage(message: any): void;
    recvMessage(callback: MessageReceiver): CleanupReceiver;
    reloadWorker(): Promise<void>;
    unloadWorker(): Promise<void>;
  }
  export interface MessageEvent {
    data: any;
  }
  export interface Postable {
    postMessage(data: any): void;
  }
  export interface Receivable {
    recvMessage(callback: (ev: MessageEvent) => void): () => void;
  }
  export interface RPCOptions {
    target: Postable;
    serviceId: string;
    receiver?: Receivable;
  }
  export class RPC {
    readonly isReady: Promise<void>;
    constructor(options: RPCOptions);
    expose<T>(method: string, handler: (params: T) => Promise<any> | any): this;
    call<T>(method: string, params?: object, waitForReply?: true): Promise<T>;
    call(method: string, params?: object, waitForReply?: false): void;
    destroy(): void;
  }
  export class RemoteContext implements Context {
    protected readonly rpc: RPC;
    constructor(rpc: RPC);
    postMessage(message: any): void;
    recvMessage(callback: MessageReceiver): CleanupReceiver;
    reloadWorker(): Promise<void>;
    unloadWorker(): Promise<void>;
    browse(url: string): Promise<void>;
  }
  export class IFrameContext extends RemoteContext {
    constructor(frame: HTMLIFrameElement);
  }
}
