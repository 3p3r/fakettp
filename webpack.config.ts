import fs from "fs";
import path from "path";
import webpack, { ProvidePlugin } from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";
import TerserWebpackPlugin from "terser-webpack-plugin";
import WebpackShellPlugin from "webpack-shell-plugin-next";

import "webpack-dev-server";

const DIST = path.resolve(__dirname, "dist");

const mainConfig: webpack.Configuration = {
  target: "web",
  entry: "./src/index.ts",
  mode: "production",
  output: {
    path: DIST,
    clean: true,
    filename: "fakettp.js",
    libraryTarget: "umd",
    umdNamedDefine: true,
    globalObject: `(typeof self !== 'undefined' ? self : this)`,
    library: {
      commonjs: "fakettp",
      amd: "fakettp",
      root: "FAKETTP",
    },
  },
  devServer: {
    open: false,
    host: "localhost",
    static: DIST,
  },
  plugins: [
    new ProvidePlugin({
      process: "process/browser",
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "package.json",
          to: DIST,
          transform: (content) => {
            const pkg = JSON.parse(content.toString());
            delete pkg.private;
            delete pkg.scripts;
            delete pkg.devDependencies;
            pkg.main = "build/index.js";
            pkg.files = ["LICENSE", "README.md", mainConfig.output?.filename, noswConfig.output?.filename, "build"];
            return JSON.stringify(pkg, null, 2);
          },
        },
        {
          from: "README.md",
          to: DIST,
        },
        {
          from: "LICENSE",
          to: DIST,
        },
      ],
    }),
  ],
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        loader: "ts-loader",
        exclude: ["/node_modules/"],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    fallback: {
      util: require.resolve("util/"),
      events: require.resolve("events/"),
      buffer: require.resolve("buffer/"),
      stream: require.resolve("stream-browserify"),
    },
  },
  performance: {
    hints: false,
  },
  optimization: {
    minimizer: [
      new TerserWebpackPlugin({
        extractComments: false,
        terserOptions: {
          format: {
            comments: false,
          },
        },
      }),
    ],
  },
};

mainConfig.plugins?.push(
  new webpack.DefinePlugin({
    "process.env.FAKETTP_MODE": JSON.stringify(mainConfig.mode),
    "process.env.FAKETTP_MAIN": JSON.stringify(mainConfig.output?.filename),
  })
);

if (mainConfig.mode === "development") {
  mainConfig.devtool = "inline-source-map";
} else {
  mainConfig.devtool = false;
}

function createConfigForExample(name: string) {
  const _name = `sample-${name}`;
  const config: webpack.Configuration = {
    mode: mainConfig.mode,
    target: "web",
    devtool: false,
    entry: `./ext/samples/${name}.ts`,
    output: {
      path: DIST,
      filename: `${_name}.js`,
    },
    module: {
      rules: [
        {
          test: /\/ws\//,
          loader: "null-loader",
          include: /node_modules/,
        },
        {
          test: /\.(ts|tsx)$/i,
          loader: "ts-loader",
          exclude: ["/node_modules/"],
        },
      ],
    },
    resolve: {
      extensions: [".ts", ".js"],
      fallback: {
        http: require.resolve("./src/index.ts"),
        fs: require.resolve("memfs"),
        net: require.resolve("net-browserify"),
        path: require.resolve("path-browserify"),
        util: require.resolve("util/"),
        events: require.resolve("events/"),
        buffer: require.resolve("buffer/"),
        stream: require.resolve("stream-browserify"),
        assert: require.resolve("assert/"),
        zlib: require.resolve("browserify-zlib"),
        crypto: require.resolve("crypto-browserify"),
        timers: require.resolve("./ext/timers.ts"),
        querystring: require.resolve("querystring-es3"),
        async_hooks: false,
        https: false,
        tls: false,
      },
    },
    plugins: [
      new webpack.ProvidePlugin({
        clearImmediate: ["timers-browserify", "clearImmediate"],
        setImmediate: ["timers-browserify", "setImmediate"],
        process: "process/browser",
        Buffer: ["buffer", "Buffer"],
        url: ["url", "URL"],
      }),
      new HtmlWebpackPlugin({
        filename: `${_name}.html`,
        templateContent: makeTemplateContent(_name),
      }),
    ],
    ignoreWarnings: [{ module: /express\/lib\/view\.js/, message: /Critical dependency/ }],
    performance: mainConfig.performance,
    optimization: mainConfig.optimization,
  };
  return config;
}

const noswConfig: webpack.Configuration = {
  target: "web",
  entry: "./src/nosw.ts",
  mode: "production",
  output: {
    path: DIST,
    filename: "nosw.js",
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/i,
        loader: "ts-loader",
        exclude: ["/node_modules/"],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
};

function makeTemplateContent(name: string) {
  return `\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${name} - fakettp samples</title>
    <link rel="shortcut icon" href="data:image/x-icon;," type="image/x-icon" />
  </head>
  <body>
    <h1>${name} (fakettp demo)</h1>
  </body>
</html>\n`;
}

function makeTemplateIndexContent(...names: string[]) {
  return `\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>fakettp</title>
    <link rel="shortcut icon" href="data:image/x-icon;," type="image/x-icon" />
    <script src="fakettp.js"></script>
  </head>
  <body>
    <h1>fakettp</h1>
    <h2 style="color:red">for best results, view this page in Chrome and in incognito mode.</h2>
    <p>Examples:</p>
    <ul>
${names.map((name) => `      <li><a href="sample-${name}.html">${name}</a></li>`).join("\n")}
    </ul>
  </body>
</html>\n`;
}

function createConfigForExamples(...names: string[]) {
  const configs: webpack.Configuration[] = [];
  for (const name of names) {
    configs.push(createConfigForExample(name));
  }
  if (mainConfig.output) mainConfig.output.clean = false;
  mainConfig.plugins?.push(
    new WebpackShellPlugin({
      safe: true,
      onAfterDone: {
        blocking: false,
        parallel: true,
        scripts: [
          "npx tsc",
          async function () {
            await fs.promises.writeFile(path.resolve(DIST, "index.html"), makeTemplateIndexContent(...names));
          },
        ],
      },
    })
  );
  return configs;
}

export default [mainConfig, noswConfig, ...createConfigForExamples("express", "express-static", "socket-io")];
