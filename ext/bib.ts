// BIB: Browser In Browser.
export async function createBib(initialUrl: string) {
  const html = `\
<div id="bib">
  <iframe id="bib-frame" sandbox="allow-same-origin" seamless></iframe>
  <input id="bib-url" />
</div>`;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const bib = doc.getElementById("bib")! as HTMLDivElement;
  const frame = doc.getElementById("bib-frame")! as HTMLIFrameElement;
  const url = doc.getElementById("bib-url")! as HTMLInputElement;
  const style = document.createElement("style");
  style.textContent = `\
#bib {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 999;
  background: #fff;
}
#bib-frame {
  position: fixed;
  top: 2em;
  left: 0;
  width: 100%;
  height: calc(100% - 2em);
}
#bib-url {
  position: fixed;
  top: 0;
  right: 0;
  width: 100%;
  height: 2em;
  background: #eee;
  text-align: center;
}
`;
  document.head.appendChild(style);
  document.body.appendChild(bib);
  async function navigateTo(address: string) {
    const _url = new URL(initialUrl);
    frame.src = _url.href;
    url.value = address;
  }
  navigateTo(initialUrl);
  url.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      navigateTo(url.value);
    }
  });
  frame.addEventListener("error", (err) => {
    frame.srcdoc = err.message;
  });
}
