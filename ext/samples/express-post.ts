import cors from "cors";
import express from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";

const app = express();
const server = createServer(app);

app.use(cors());

app.get("/", (req, res) => {
  console.log("Request received.", req.url);
  res.send("Hello From Express.");
});

app.post("/", (req, res) => {
  console.log("POST request received.", req.url);
  req.pipe(res);
});

server.listen(async () => {
  console.log(`Server listening on ${server.address()}.`);
  const address = server.address() as AddressInfo;
  const scheme = address.port === 443 ? "https" : "http";
  const url = `${scheme}://${address.address}:${address.port}/`;
  const response = await fetch(url, { method: "POST", body: "Hello From Fetch." });
  console.log("Response received.", response.status, response.statusText);
  console.log("Response body:", await response.text());
  alert("Check console for logs!");
});
