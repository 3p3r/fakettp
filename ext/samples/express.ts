import cors from "cors";
import express from "express";
import { createBib } from "../bib";
import { createServer } from "http";
import type { AddressInfo } from "net";

const app = express();
const server = createServer(app);

app.use(cors());

app.get("/", (req, res) => {
  console.log("Request received.", req.url);
  res.send("Hello From Express.");
});

server.listen(() => {
  console.log(`Server listening on ${server.address()}.`);
  const address = server.address() as AddressInfo;
  const scheme = address.port === 443 ? "https" : "http";
  createBib(`${scheme}://${address.address}:${address.port}/`);
});
