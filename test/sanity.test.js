const { expect, browser } = require("@wdio/globals");

describe("Sanity", () => {
  before(async () => {
    await browser.navigateTo("http://localhost:8080/index.html");
  });
  it("should always pass", async () => {
    await expect(true).toBe(true);
    const FAKETTP = await browser.execute(() => window.FAKETTP);
    await expect(FAKETTP).toBeDefined();
  });
  it("should have sane network behavior before testing", async () => {
    await expect(browser.execute(() => fetch("http://localhost:8080/index.html").then(({ ok }) => ok))).resolves.toBe(
      true
    );
    await expect(
      browser.execute(() => fetch("http://localhost:8080/html.index").then(({ ok }) => ok)).catch(() => false)
    ).resolves.toBe(false);
  });
});
