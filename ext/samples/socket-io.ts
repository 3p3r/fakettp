import express from "express";
import { createServer } from "http";
import * as SocketClient from "socket.io-client";
import { Server as SocketServer } from "socket.io";

const app = express();
const httpServer = createServer(app);

const ioServer = new SocketServer(httpServer, {
  transports: ["polling"],
  httpCompression: false,
  allowUpgrades: false,
  serveClient: false,
  allowEIO3: true,
});

ioServer.once("connection", (socket) => {
  console.log(`Socket connected (${socket.id})`);
  socket.send("hello");
});

setInterval(() => {
  ioServer.emit("believe", new Date());
}, 1000);

httpServer.listen(443, "google.com", () => {
  console.log(`Server listening on ${httpServer.address()}.`);
  createSocket("client");
});

function createSocket(name: string) {
  const socket = SocketClient.connect("https://google.com/");
  socket.once("connection", (connection) => {
    console.log(`${name} connected (${connection.id})`);
  });
  socket.onAny((event, ...args) => {
    console.log(`${name} received event: ${event}`, args);
  });
}
