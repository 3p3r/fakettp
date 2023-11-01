import { vol } from "memfs";

vol.fromNestedJSON({
  "/public/": {
    "index.html": "<html><body><h1>No Way!</h1></body></html>",
  },
});

import express from "express";
import { createServer } from "http";

const app = express();
const server = createServer(app);

app.use(express.static("public"));

server.listen(443, "google.com", () => {
  console.log(`Server listening on ${server.address()}.`);
});
