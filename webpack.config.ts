import path from "path";
import webpack, { ProvidePlugin } from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";
import CopyWebpackPlugin from "copy-webpack-plugin";

import "webpack-dev-server";

const DIST = path.resolve(__dirname, "dist");

const CONFIG: webpack.Configuration = {
  target: "web",
  entry: "./src/index.ts",
  mode: "production",
  output: {
    path: DIST,
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
    new HtmlWebpackPlugin({
      template: "./src/index.ejs",
    }),
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
            pkg.main = CONFIG.output!.filename;
            pkg.files = ["fakettp.js", "README.md", "LICENSE"];
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
      events: require.resolve("events/"),
      buffer: require.resolve("buffer/"),
      stream: require.resolve("stream-browserify"),
    },
  },
  performance: {
    hints: false,
  },
};

CONFIG.plugins?.push(
  new webpack.DefinePlugin({
    "process.env.WEBPACK_MODE": JSON.stringify(CONFIG.mode),
    "process.env.WEBPACK_FILENAME": JSON.stringify(CONFIG.output?.filename),
  })
);

if (CONFIG.mode === "development") {
  CONFIG.devtool = "inline-source-map";
} else {
  CONFIG.devtool = false;
}

export default CONFIG;
