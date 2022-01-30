import Worker from "worker-loader!./worker.js";
import * as Comlink from "comlink";

import * as lib from "../lib";

async function runTests() {
  await navigator.serviceWorker.register("./sw.js");
  const serviceWorkerChannel = await lib.makeServiceWorkerChannel();
  if (!serviceWorkerChannel) {
    location.reload();
  }

  const channels = [serviceWorkerChannel];
  if (typeof SharedArrayBuffer !== "undefined") {
    channels.push(lib.makeAtomicsChannel());
  }

  const {testRead, testInterrupt} = Comlink.wrap(new Worker());
  const testResults = [];
  let test = "uuid";

  for (let i = 0; i < 100; i++) {
    const uuid = lib.uuidv4();
    testResults.push({
      uuid,
      test,
      i,
      // e.g. 3676018a-94a4-4b07-81c2-dfa14b69b1fd
      passed: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid),
    })
  }

  test = "read_serial";
  for (const {channel, writeInput} of channels) {
    for (let i = 0; i < 100; i++) {
      const messageId = randomString();
      const message = randomString();
      const readPromise = testRead(channel, messageId);
      await writeInput({message}, messageId);
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
  for (const {channel} of channels) {
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

  const {channel, writeInput} = serviceWorkerChannel;
  let promises = [],
    localResults;

  test = "concurrent";
  for (let i = 0; i < 100; i++) {
    const messageId = randomString();
    const message = randomString();
    const readPromise = testRead(channel, messageId);
    const writePromise = writeInput(message, messageId);
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
    const messageId = randomString();
    const readPromise = testRead(channel, messageId);
    promises.push(readPromise);
    localResults.push({readPromise, messageId, i});
  }
  await lib.asyncSleep(500);
  for (const result of localResults) {
    const message = randomString();
    const writePromise = writeInput(message, result.messageId);
    promises.push(writePromise);
    testResults.push({test, channel: channel.type, message, ...result});
  }

  localResults = [];
  test = "write_first";
  for (let i = 0; i < 100; i++) {
    const messageId = randomString();
    const message = randomString();
    const writePromise = writeInput(message, messageId);
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

  window.testResults = testResults;
  console.log(testResults);

  let numPassed = testResults.filter((t) => t.passed).length;
  let numTotal = testResults.length;
  let finalResult = numPassed === numTotal ? "PASSED" : "FAILED";
  const body = document.getElementsByTagName("body")[0];
  body.innerHTML = `<div id=result>${numPassed} / ${numTotal} : ${finalResult}!</div>`;
}

function randomString() {
  return `${+new Date()} ${Math.random()} ${Math.random()} ${Math.random()}`;
}

runTests();
