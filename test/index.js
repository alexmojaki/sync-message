import Worker from "worker-loader!./worker.js";
import * as Comlink from "comlink";

import * as lib from "../lib"

async function runTests() {
  await navigator.serviceWorker.register("./sw.js");
  const channels = [
    await lib.makeServiceWorkerChannel({timeout: 1000}),
    lib.makeAtomicsChannel(),
  ]
  if (!channels[0]) {
    location.reload();
  }
  const {testRead, testInterrupt} = Comlink.wrap(new Worker());
  const testResults = []

  for (const {channel, writeInput} of channels) {
    for (let i = 0; i < 100; i++) {
      const messageId = randomString();
      const message = randomString();
      const readPromise = testRead(channel, messageId);
      await writeInput(message, messageId);
      const response = await readPromise;
      testResults.push({
        message,
        response,
        messageId,
        passed: response === message,
        channel: channel.type,
        i,
        test: "read",
      });
    }
  }

  for (const {channel} of channels) {
    for (let i = 0; i < 3; i++) {
      const readPromise = testInterrupt(channel);
      const passed = await readPromise;
      testResults.push({
        passed,
        channel: channel.type,
        i,
        test: "interrupt",
      });
    }
  }

  window.testResults = testResults;
  console.log(testResults);

  let numPassed = testResults.filter(t => t.passed).length;
  let numTotal = testResults.length;
  let finalResult = numPassed === numTotal ? 'PASSED' : 'FAILED';
  document.getElementsByTagName("body")[0].innerText =
    `${numPassed} / ${numTotal} : ${finalResult}!`;
}

function randomString() {
  return `${+new Date()} ${Math.random()} ${Math.random()} ${Math.random()}`
}

runTests();
