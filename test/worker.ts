/* eslint-disable */
// Otherwise webpack fails silently
// https://github.com/facebook/create-react-app/issues/8014

import * as lib from "../lib";
import * as Comlink from "comlink";

function testRead(channel: lib.Channel, messageId: string) {
  return lib.readChannel(channel, messageId, {checkTimeout: 10});
}

function testInterrupt(channel: lib.Channel) {
  const start = Date.now();
  const timePassed = () => Date.now() - start > 300;
  lib.readChannel(channel, "messageId", {
    checkInterrupt: timePassed,
    checkTimeout: 10,
  });
  return timePassed();
}

function testSleep(ms: number, channel: lib.Channel) {
  const start = performance.now();
  lib.syncSleep(ms, channel);
  return performance.now() - start;
}

Comlink.expose({testRead, testInterrupt, testSleep});
