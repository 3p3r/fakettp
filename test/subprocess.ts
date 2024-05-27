import assert from "assert";
import { MessagePort } from "../src/channel";
import { type Context } from "../src/context";
class SubProcessContext implements Context {
  postMessage = (message: any) => {
    assert.ok(process.send);
    process.send(message);
  };
  readMessages = (cb: any) => {
    process.on("message", cb);
    return () => {
      process.off("message", cb);
    };
  };
  reloadWorker = () => assert.ok(false);
  unloadWorker = () => assert.ok(false);
}
process.on("message", ({ port, message }) => {
  if (typeof port === "string") {
    const _port = new MessagePort(port, new SubProcessContext());
    _port.start();
    setTimeout(() => {
      _port.postMessage(message);
    }, 1000);
  }
});
