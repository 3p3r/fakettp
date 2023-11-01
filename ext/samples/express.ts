import express from "express";
import { createServer } from "http";

const app = express();
const server = createServer(app);

app.get("/", (req, res) => {
  console.log("Request received.", req.url);
  res.send("Hello From Express!");
});

server.listen(443, "google.com", () => {
  console.log(`Server listening on ${server.address()}.`);
});
