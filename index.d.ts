declare module "fakettp" {
  type CleanupReceiver = () => void | Promise<void>;
  type MessageReceiver = (message: any) => void | Promise<void>;
  export interface Context {
    readonly postMessage: MessageReceiver;
    readonly readMessages: (callback: MessageReceiver) => CleanupReceiver;
    readonly reloadWorker?: () => void | Promise<void>;
    readonly unloadWorker?: () => void | Promise<void>;
  }
  export function setContext(context: Context): void;
  export function getContext(): Context;
  export class DefaultContext implements Context {
    constructor(config?: { include?: RegExp[]; exclude?: RegExp[] });
    postMessage(message: any): void;
    readMessages(callback: MessageReceiver): CleanupReceiver;
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
    readMessages(callback: (ev: MessageEvent) => void): () => void;
  }
  export interface RPCOptions {
    target: Postable;
    serviceId: string;
    receiver?: Receivable;
  }
  export class RPC {
    readonly isReady: Promise<void>;
    constructor(options: RPCOptions);
    create(options: RPCOptions): Promise<RPC>;
    expose<T>(method: string, handler: (params: T) => Promise<any> | any): this;
    call<T>(method: string, params: object, waitForReply?: true): Promise<T>;
    call(method: string, params: object, waitForReply: false): void;
    destroy(): void;
  }
}
