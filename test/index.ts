import {makeChannel, writeMessage} from "../lib";

const Worker = require("worker-loader!./worker").default;
import * as Comlink from "comlink";

import * as lib from "../lib";

async function runTests() {
  await navigator.serviceWorker.register("./sw.js");
  const serviceWorkerChannel = lib.makeServiceWorkerChannel({timeout: 1000});
  try {
    await writeMessage(serviceWorkerChannel, "test", "foo");
  } catch (e) {
    console.error(e);
    window.location.reload();
  }

  const channels: lib.Channel[] = [serviceWorkerChannel];
  const hasSAB = typeof SharedArrayBuffer !== "undefined";
  if (hasSAB) {
    channels.push(lib.makeAtomicsChannel());
  }

  const {testRead, testInterrupt, testSleep} = Comlink.wrap(new Worker()) as any;
  const testResults = [];
  let test = "uuid";

  for (let i = 0; i < 100; i++) {
    const uuid = lib.uuidv4();
    testResults.push({
      uuid,
      test,
      i,
      // e.g. 3676018a-94a4-4b07-81c2-dfa14b69b1fd
      passed: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
        uuid,
      ),
    });
  }

  {
    test = "makeChannel";
    const {type} = makeChannel();
    const expectedType: typeof type = hasSAB ? "atomics" : "serviceWorker";
      testResults.push({
        test,
        type,
        expectedType,
        passed: type === expectedType,
      });
  }

  test = "read_serial";
  for (const channel of channels) {
    for (let i = 0; i < 100; i++) {
      const messageId = lib.uuidv4();
      const message = lib.uuidv4();
      const readPromise = testRead(channel, messageId);
      await lib.writeMessage(channel, {message}, messageId);
      const response = (await readPromise).message;
      testResults.push({
        message,
        response,
        messageId,
        passed: response === message,
        channel: channel.type,
        i,
        test,
      });
    }
  }

  test = "interrupt";
  for (const channel of channels) {
    for (let i = 0; i < 3; i++) {
      const readPromise = testInterrupt(channel);
      const passed = await readPromise;
      testResults.push({
        passed,
        channel: channel.type,
        i,
        test,
      });
    }
  }

  const channel = serviceWorkerChannel;
  let promises = [],
    localResults;

  test = "concurrent";
  for (let i = 0; i < 100; i++) {
    const messageId = lib.uuidv4();
    const message = lib.uuidv4();
    const readPromise = testRead(channel, messageId);
    const writePromise = writeMessage(channel, message, messageId);
    promises.push(readPromise, writePromise);
    testResults.push({
      test,
      channel: channel.type,
      readPromise,
      message,
      messageId,
      i,
    });
  }

  localResults = [];
  test = "read_first";
  for (let i = 0; i < 100; i++) {
    const messageId = lib.uuidv4();
    const readPromise = testRead(channel, messageId);
    promises.push(readPromise);
    localResults.push({readPromise, messageId, i});
  }
  await lib.asyncSleep(500);
  for (const result of localResults) {
    const message = lib.uuidv4();
    const writePromise = writeMessage(channel, message, result.messageId);
    promises.push(writePromise);
    testResults.push({test, channel: channel.type, message, ...result});
  }

  localResults = [];
  test = "write_first";
  for (let i = 0; i < 100; i++) {
    const messageId = lib.uuidv4();
    const message = lib.uuidv4();
    const writePromise = writeMessage(channel, message, messageId);
    promises.push(writePromise);
    localResults.push({message, messageId, i});
  }
  await lib.asyncSleep(500);
  for (const result of localResults) {
    const readPromise = testRead(channel, result.messageId);
    promises.push(readPromise);
    testResults.push({test, channel: channel.type, readPromise, ...result});
  }

  await Promise.all(promises);
  for (const result of testResults) {
    if ("readPromise" in result) {
      result.passed = (await result.readPromise) === result.message;
    }
  }

  test = "sync_sleep";
  for (const ms of [500, 800]) {
    const slept = await testSleep(ms, channel);
    testResults.push({
      test,
      channel: channel.type,
      ms,
      slept,
      passed: slept > ms && slept < ms * 1.5,
    });
  }

  (window as any).testResults = testResults;
  console.log(testResults);

  let numPassed = testResults.filter((t) => t.passed).length;
  let numTotal = testResults.length;
  let finalResult = numPassed === numTotal ? "PASSED" : "FAILED";
  const body = document.getElementsByTagName("body")[0];
  body.innerHTML = `<div id=result>${numPassed} / ${numTotal} : ${finalResult}!</div>`;
}

runTests();
