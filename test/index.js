import Worker from "worker-loader!./worker.js";
import * as Comlink from "comlink";

import * as lib from "../lib"

async function init() {
  await navigator.serviceWorker.register("./sw.js");
  const channels = [
    await lib.makeServiceWorkerChannel({timeout: 1000}),
    lib.makeAtomicsChannel(),
  ]
  if (!channels[0]) {
    location.reload();
  }
  const {testRead, testInterrupt} = Comlink.wrap(new Worker());

  for (const {channel, writeInput} of channels) {
    for (let i = 0; i < 100; i++) {
      const messageId = randomString();
      const message = randomString();
      const readPromise = testRead(channel, messageId);
      await writeInput(message, messageId);
      const response = await readPromise;
      console.log(response === message);
    }
  }

  for (const {channel} of channels) {
    for (let i = 0; i < 3; i++) {
      const readPromise = testInterrupt(channel);
      const response = await readPromise;
      console.log(response);
    }
  }
}

export function randomString() {
  return `${+new Date()} ${Math.random()} ${Math.random()} ${Math.random()}`
}

init();
