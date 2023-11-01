const express = require("express");
const { URL } = require("url");

let server = null;

module.exports.config = {
  runner: "local",
  specs: ["./test/sanity.test.js", "./test/**/*.test.js"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "chrome",
      "goog:chromeOptions": {
        args: ["--headless", "--disable-gpu"],
      },
    },
  ],
  logLevel: "error",
  bail: 0,
  baseUrl: "http://localhost:8080",
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },
  onPrepare: async function (config) {
    const url = new URL(config.baseUrl);
    const port = url.port ? url.port : url.protocol === "https" ? 443 : 80;
    await new Promise((resolve, reject) => {
      const app = express();
      app.use(express.static("dist"));
      server = app.listen(port, resolve).on("error", reject);
    });
  },
  onComplete: async function () {
    await new Promise((resolve) => server.close(resolve));
  },
};
