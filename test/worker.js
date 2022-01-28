/* eslint-disable */
// Otherwise webpack fails silently
// https://github.com/facebook/create-react-app/issues/8014

import * as lib from "../lib";
import * as Comlink from "comlink";

function testRead(channel, messageId) {
  return lib.readChannel(channel, messageId);
}

function testInterrupt(channel) {
  const start = new Date();
  const timePassed = () => new Date() - start > 300;
  lib.readChannel(channel, "messageId", { checkInterrupt: timePassed });
  return timePassed();
}

Comlink.expose({ testRead, testInterrupt });
