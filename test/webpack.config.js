const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  mode: 'development',
  entry: {
    index: "./index.js",
    sw: "./sw.js",
  },
  devServer: {
    static: './dist',
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  },
  output: {
    path: __dirname + '/dist',
    filename: "[name].js",
  },
  plugins: [
    new HtmlWebpackPlugin({excludeChunks: ["sw"]})
  ],
}
