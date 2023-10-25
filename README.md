# fakettp

fake browser side http server via service workers with node api compatibility.

# usage

## bundlers

you can alias `http` to `fakettp` in your bundler config to use it as a drop in
replacement for node's http module. Example webpack config:

```sh
npm install fakettp --save-dev
```

```js
module.exports = {
  resolve: {
    alias: {
      http: "fakettp",
    },
    // or
    fallback: {
      http: require.resolve("fakettp"),
    }
  },
};
```

## browsers

this is a library primarily intended for use in bundlers like webpack.
example use case would be running an express app or socket io app locally.

a single global variable `FAKETTP` is exposed which partially implements socket,
net.stream, and net.server, and net.http interfaces from node.

it currently implements enough to run most express and socket io apps untouched.
socket io needs to be tuned in client side to use polling and not web sockets.

`http.createServer` is the main entry point (or rather `FAKETTP.createServer`).
fakettp is built into a UMD module, so it can be used in bundlers or browsers.

# example

![demo](./ext/demo.png)

You can create a server and listen like so:

```js
FAKETTP.createServer().on("request", (req, res) => {
  req.on('data', (chunk) => {
    console.log(`Received ${chunk.length} bytes of data in request body.`);
    console.log(`Request chunk: ${chunk.toString()}`);
  });
  req.on('end', () => {
    console.log('No more data in request body.');
  });
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('{"yo":"nice"}');
}).listen();
```

![listen](./ext/listen.png)

After that all requests will be intercepted and handled by the service worker.
Only requests to the same origin will be intercepted (excluding worker itself).
The HTML page loading the worker is also excluded from interception.

You can for example send a request to the server like so:

```js
async function postData(data = {}, url = "test.html") {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  return response.json();
}

postData({ answer: "browser" }).then((data) => {
  console.log(data);
});
```

![response](./ext/response.png)

# development

- Run `npm run build` to build the project.
- Run `npm run serve` to start webpack dev server.
- Run `npm run watch` to watch for changes and rebuild.
- Run `npx http-serve --cors dist` to run production build.

in dev modes, verbose logging is enabled. in production, it is disabled.
