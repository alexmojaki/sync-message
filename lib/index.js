const scope = "/__SyncWebWorkerServiceWorkerInput__";

export function serviceWorkerFetchListener() {
  const earlyMessages = {};
  const resolvers = {};

  return (e) => {
    const {url} = e.request;
    if (!url.includes(scope)) {
      return false;
    }

    async function respond() {
      if (url.endsWith("/read")) {
        const {messageId} = await e.request.json();
        const data = earlyMessages[messageId];
        if (data) {
          delete earlyMessages[messageId];
          return new Response(data, {status: 200});
        } else {
          return await new Promise(r => resolvers[messageId] = r);
        }
      } else if (url.endsWith("/write")) {
        const {data, messageId} = await e.request.json();
        const resolver = resolvers[messageId];
        if (resolver) {
          resolver(new Response(data, {status: 200}));
          delete resolvers[messageId];
        } else {
          earlyMessages[messageId] = data;
        }
        return new Response(data, {status: 200});
      }
    }

    e.respondWith(respond());
    return true;
  };
}

export function asyncSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function makeAtomicsChannel() {
  const data = new Uint8Array(new SharedArrayBuffer(128 * 1024));
  const meta = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2));
  const encoder = new TextEncoder();

  return {
    channel: {type: 'atomics', data, meta},
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
}

export function makeServiceWorkerChannel(options = {}) {
  const registrationPromise = navigator.serviceWorker.register(options.serviceWorkerPath,);

  return {
    channel: {type: 'serviceWorker', scope},
    writeInput: async function (data, messageId) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const registration = await registrationPromise;
        if (registration.active) {
          await fetch(scope + "/write", {method: "POST", body: JSON.stringify({data, messageId})});
          break;
        }
        await asyncSleep(100);
      }
    },
  }
}

export function readChannel(channel, messageId, options = {}) {
  if (channel.type === 'atomics') {
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
    request.open('POST', channel.scope + "/read", false);
    request.send(JSON.stringify({messageId}));
    return request.responseText;
  }
}
