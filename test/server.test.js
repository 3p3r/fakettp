const { expect, browser } = require("@wdio/globals");

describe("http.Server", () => {
  it("should be able to http.createServer, listen, and close", async () => {
    await browser.reloadSession();
    await browser.url("index.html");
    await expect(
      browser.execute(() =>
        fetch("https://example.com")
          .then(({ ok }) => ok)
          .catch(() => false)
      )
    ).resolves.toBe(false);
    /** @type {typeof import("http")} */
    const FAKETTP = await browser.execute(() => window.FAKETTP);
    await expect(FAKETTP).toBeDefined();
    await browser.executeAsync((done) => {
      const server = FAKETTP.createServer((req, res) => {
        res.end("hello world");
      });
      server.listen(443, "example.com", done);
      window.server = server;
    });
    await expect(browser.execute(() => fetch("https://example.com").then(({ ok }) => ok))).resolves.toBe(true);
    await expect(browser.execute(() => fetch("https://example.com").then((res) => res.text()))).resolves.toBe(
      "hello world"
    );
    await expect(browser.executeAsync((done) => window.server.close(done))).resolves.toBeNull();
    await expect(
      browser.execute(() =>
        fetch("https://example.com")
          .then(({ ok }) => ok)
          .catch(() => false)
      )
    ).resolves.toBe(false);
  });

  it("should be able to transfer data with POST", async () => {
    await browser.reloadSession();
    await browser.url("index.html");
    await expect(
      browser.executeAsync((done) => {
        let reqBody = "";
        let resBody = "";
        const server = FAKETTP.createServer()
          .on("request", (req, res) => {
            req.on("data", (chunk) => {
              reqBody += chunk.toString();
            });
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end('{"yo":"nice"}');
          })
          .listen(443, "example.com", () => {
            fetch("https://example.com/fake.html", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ answer: "browser" }),
            })
              .then((res) => res.json())
              .then((data) => {
                resBody = data;
                server.close(() => {
                  done({ reqBody, resBody });
                });
              })
              .catch((err) => {
                server.close(() => {
                  done(err.message);
                });
              });
          });
      })
    ).resolves.toEqual({ reqBody: '{"answer":"browser"}', resBody: { yo: "nice" } });
  });
});
