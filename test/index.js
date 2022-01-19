import Worker from "worker-loader!./worker.js";
import * as Comlink from "comlink";

import * as lib from "../lib"

async function init() {
  await navigator.serviceWorker.register("./sw.js");
  const channels = [
    await lib.makeServiceWorkerChannel(),
    lib.makeAtomicsChannel(),
  ]
  const {testWorker} = Comlink.wrap(new Worker());

  for (const {channel, writeInput} of channels) {
    for (let i = 0; i < 100; i++) {
      const messageId = uuidv4();
      const readPromise = testWorker(channel, messageId);
      const message = Math.random() + " " + new Date();
      await writeInput(message, messageId);
      const response = await readPromise;
      console.log(response === message);
    }
  }
}

// https://stackoverflow.com/a/2117523/2482744
export function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

init();
