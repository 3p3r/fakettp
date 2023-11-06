import { vol } from "memfs";

vol.fromNestedJSON({
  "/public/": {
    "index.html": "<html><body><a href='memfs.html'>memfs.html</a></body></html>",
    "memfs.html": "<html><body><a href='index.html'>index.html</a></body></html>",
  },
});

import cors from "cors";
import express from "express";
import { createBib } from "../bib";
import { createServer } from "http";
import type { AddressInfo } from "net";

const app = express();
const server = createServer(app);

app.use(cors());
app.use(express.static("public"));

server.listen(() => {
  console.log(`Server listening on ${server.address()}.`);
  const address = server.address() as AddressInfo;
  const scheme = address.port === 443 ? "https" : "http";
  createBib(`${scheme}://${address.address}:${address.port}/`);
});
