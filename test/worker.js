/* eslint-disable */
// Otherwise webpack fails silently
// https://github.com/facebook/create-react-app/issues/8014

import * as lib from "../lib"
import * as Comlink from "comlink";

function testWorker(channel, messageId) {
  return lib.readChannel(channel, messageId);
}

Comlink.expose({testWorker});
