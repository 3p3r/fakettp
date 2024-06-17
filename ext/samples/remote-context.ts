import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";

import { createBib } from "../bib";
import { IFrameContext, setContext } from "../../src/context";

async function wrapUp(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  alert(text); // Hello From Remote Context!
}

const serviceUrl = new URL("fakettp.html", location.href);

createBib(serviceUrl.href).then((frame) => {
  frame.onload = () => {
    const context = new IFrameContext(frame);
    setContext(context);

    const app = express();
    const server = createServer(app);

    app.get("/", (req, res) => {
      console.log("Request received.", req.url);
      res.send("Hello From Remote Context!");
    });

    server.listen(() => {
      console.log(`Server listening on ${server.address()}.`);
      const address = server.address() as AddressInfo;
      const scheme = address.port === 443 ? "https" : "http";
      const url = `${scheme}://${address.address}:${address.port}/`;
      wrapUp(url);
    });
  };
});
