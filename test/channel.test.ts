import { resolve } from "path";
import { fork } from "child_process";
import { MessageChannel, MessagePort } from "../src/channel";
import { type Context } from "../src/context";
import { EventEmitter } from "events";
import * as assert from "uvu/assert";
import { suite } from "uvu";

const it = suite("MessageChannel tests");

class SameThreadContext implements Context {
  readonly emitter = new EventEmitter();
  postMessage(message: any) {
    this.emitter.emit("message", message);
  }
  readMessages(cb: (message: any) => void | Promise<void>) {
    this.emitter.on("message", cb);
    return () => {
      this.emitter.off("message", cb);
    };
  }
  unloadWorker = () => assert.ok(false);
  reloadWorker = () => assert.ok(false);
}

class SubProcessContext implements Context {
  readonly child = fork(resolve(__dirname, "subprocess.ts"));
  postMessage(message: any) {
    this.child.send(message);
  }
  readMessages(cb: (message: any) => void | Promise<void>) {
    this.child.on("message", cb);
    return () => {
      this.child.off("message", cb);
    };
  }
  unloadWorker = () => assert.ok(false);
  reloadWorker = () => assert.ok(false);
}

it("should correctly serialize ports", async () => {
  const testContext = new SameThreadContext();
  const testChannel = new MessageChannel(testContext);
  const serialized = { ...testChannel };
  assert.equal(serialized.port1.toJSON(), testChannel.port1.toString());
  assert.equal(serialized.port2.toJSON(), testChannel.port2.toString());
});

it("should be able to send messages through MessagePort (same thread)", async () => {
  const testContext = new SameThreadContext();
  const testPort = new MessagePort("sample", testContext);
  const message = { hello: "world" };
  const promise = new Promise((resolve) => {
    testPort.onmessage = resolve;
  });
  testPort.postMessage(message);
  assert.equal(JSON.stringify(await promise), JSON.stringify(message));
});

it("should be able to send messages through MessagePort (multithread)", async () => {
  const testContext = new SubProcessContext();
  const testPort = new MessagePort("shared", testContext);
  const message = { hello: "world" };
  const promise = new Promise((resolve) => {
    testPort.onmessage = resolve;
  });
  testContext.child.send({ port: testPort.toString(), message });
  assert.equal(JSON.stringify(await promise), JSON.stringify(message));
  testContext.child.kill();
});

it("should be able to send messages through MessageChannel (same thread)", async () => {
  const testContext = new SameThreadContext();
  const testChannel = new MessageChannel(testContext);
  const message = { hello: "world" };
  const promise = new Promise((resolve) => {
    testChannel.port2.onmessage = resolve;
  });
  testChannel.port1.postMessage(message);
  assert.equal(JSON.stringify(await promise), JSON.stringify(message));
});

it("should be able to send messages through MessageChannel (multithread)", async () => {
  const testContext = new SubProcessContext();
  const testChannel = new MessageChannel(testContext);
  const message = { hello: "world" };
  const promise = new Promise((resolve) => {
    testChannel.port2.onmessage = resolve;
  });
  testContext.child.send({ port: testChannel.port1.toString(), message });
  assert.equal(JSON.stringify(await promise), JSON.stringify(message));
  testContext.child.kill();
});

it.run();
