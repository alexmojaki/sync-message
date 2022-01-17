const scope = "/__SyncWebWorkerServiceWorkerInput__";

export function setupServiceWorker() {
  const earlyMessages = {};
  const resolvers = {};

  addEventListener('message', event => {
    const {data, messageId} = event.data;
    const resolver = resolvers[messageId];
    if (resolver) {
      resolver(new Response(data, {status: 200}));
      delete resolvers[messageId];
    } else {
      earlyMessages[messageId] = data;
    }
  });

  addEventListener('fetch', (e) => {
    if (e.request.url.includes(scope)) {
      // eslint-disable-next-line no-inner-declarations
      async function respond() {
        const {messageId} = await e.request.json();
        const data = earlyMessages[messageId];
        if (data) {
          delete earlyMessages[messageId];
          return new Response(data, {status: 200});
        } else {
          return await new Promise(r => resolvers[messageId] = r);
        }
      }
      e.respondWith(respond());
    } else {
      e.respondWith(fetch(e.request));
    }
  });

  addEventListener('install', function (e) {
    e.waitUntil(self.skipWaiting());
  });

  addEventListener('activate', function (e) {
    e.waitUntil(self.clients.claim());
  });
}

export function asyncSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function makeChannel(useAtomics, options = {}) {
  if (useAtomics && typeof SharedArrayBuffer !== "undefined") {
    const data = new Uint8Array(new SharedArrayBuffer(128 * 1024));
    const meta = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
    const encoder = new TextEncoder();

    return {
      channel: {data, meta, useAtomics},
      writeInput: function (string) {
        const bytes = encoder.encode(string);
        if (bytes.length > data.length) {
          throw "Input is too long";
        }
        data.set(bytes, 0);
        Atomics.store(meta, 0, bytes.length);
        Atomics.store(meta, 1, 1);
        Atomics.notify(meta, 1);
      },
    }
  } else {
    const registrationPromise = navigator.serviceWorker.register(
      options.serviceWorkerPath,
    );

    return {
      channel: {useAtomics, scope},
      writeInput: async function (data, messageId) {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const registration = await registrationPromise;
          if (registration.active) {
            registration.active.postMessage({data, messageId});
            break;
          }
          await asyncSleep(100);
        }
      },
    }
  }
}

export function readChannel(channel, messageId, options = {}) {
  if (channel.useAtomics) {
    const {data, meta} = channel;
    const {checkInterrupt} = options;
    while (Atomics.wait(meta, 1, 0, 100) === "timed-out") {
      if (checkInterrupt?.()) {
        return null;
      }
    }
    const size = Atomics.exchange(meta, 0, 0);
    const bytes = data.slice(0, size);
    Atomics.store(meta, 1, 0);

    const decoder = new TextDecoder();
    return decoder.decode(bytes);
  } else {
    const request = new XMLHttpRequest();
    // `false` makes the request synchronous
    request.open('POST', channel.scope, false);
    request.send(JSON.stringify({messageId}));
    return request.responseText;
  }
}
