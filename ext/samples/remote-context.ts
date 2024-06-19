import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";

import { createBib } from "../bib";
import { IFrameContext, setContext } from "../../src/context";

const params = new URLSearchParams(location.search);

params.set("d", ""); // enables debugging
params.set("i", new RegExp("localhost").source);
params.append("e", new RegExp("fakettp.html").source);
params.append("e", new RegExp("fakettp.js").source);
params.append("e", new RegExp("nosw.js").source);
params.append("e", new RegExp("sample-.*").source);

const serviceUrl = new URL(`fakettp.html?${params.toString()}`, location.href);

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
      context.browse(url);
    });
  };
});
