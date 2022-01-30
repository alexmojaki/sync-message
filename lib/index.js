const BASE_URL_SUFFIX = "/__SyncMessageServiceWorkerInput__";

export function serviceWorkerFetchListener() {
  const earlyMessages = {};
  const resolvers = {};

  return (e) => {
    const {url} = e.request;
    if (!url.includes(BASE_URL_SUFFIX)) {
      return false;
    }

    async function respond() {
      function success(d) {
        return new Response(JSON.stringify(d), {status: 200});
      }

      if (url.endsWith("/read")) {
        const {messageId, timeout} = await e.request.json();
        const data = earlyMessages[messageId];
        if (data) {
          delete earlyMessages[messageId];
          return success(data);
        } else {
          return await new Promise((resolver) => {
            resolvers[messageId] = resolver;

            function callback() {
              delete resolvers[messageId];
              resolver(new Response("", {status: 408})); // timeout
            }

            setTimeout(callback, timeout);
          });
        }
      } else if (url.endsWith("/write")) {
        const {data, messageId} = await e.request.json();
        const resolver = resolvers[messageId];
        if (resolver) {
          resolver(success(data));
          delete resolvers[messageId];
        } else {
          earlyMessages[messageId] = data;
        }
        return success(data);
      } else if (url.endsWith("/version")) {
        return new Response("v1", {status: 200});
      }
    }

    e.respondWith(respond());
    return true;
  };
}

export function asyncSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function makeAtomicsChannel(options = {}) {
  const data = new Uint8Array(
    new SharedArrayBuffer(options.bufferSize || 128 * 1024),
  );
  const meta = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2),
  );
  const encoder = new TextEncoder();

  return {
    channel: {type: "atomics", data, meta},
    writeInput: function (inputData) {
      const bytes = encoder.encode(JSON.stringify(inputData));
      if (bytes.length > data.length) {
        throw "Input is too long";
      }
      data.set(bytes, 0);
      Atomics.store(meta, 0, bytes.length);
      Atomics.store(meta, 1, 1);
      Atomics.notify(meta, 1);
    },
  };
}

export async function makeServiceWorkerChannel(options = {}) {
  const registration = await navigator.serviceWorker.ready;
  const baseUrl = registration.scope + BASE_URL_SUFFIX;

  const timeout = options.timeout || 5000;
  const startTime = new Date();
  while (true) {
    const response = await fetch(baseUrl + "/version");
    if (response.status === 200 && (await response.text()) === "v1") {
      break;
    }
    if (new Date() - startTime < timeout) {
      await asyncSleep(100);
    } else {
      return null;
    }
  }

  return {
    channel: {type: "serviceWorker", baseUrl},
    writeInput: function (data, messageId) {
      return fetch(baseUrl + "/write", {
        method: "POST",
        body: JSON.stringify({data, messageId}),
      });
    },
  };
}

export function readChannel(channel, messageId, options = {}) {
  const startTime = performance.now();

  let {checkInterrupt, checkTimeout, timeout} = options;
  checkTimeout = checkTimeout > 0 ? +checkTimeout : checkInterrupt ? 100 : 5000;
  const totalTimeout = timeout > 0 ? +timeout : Number.POSITIVE_INFINITY;
  let check;

  if (channel.type === "atomics") {
    const {data, meta} = channel;

    check = () => {
      if (Atomics.wait(meta, 1, 0, checkTimeout) === "timed-out") {
        return null;
      } else {
        const size = Atomics.exchange(meta, 0, 0);
        const bytes = data.slice(0, size);
        Atomics.store(meta, 1, 0);

        const decoder = new TextDecoder();
        const text = decoder.decode(bytes);
        return JSON.parse(text);
      }
    };
  } else {
    check = () => {
      const request = new XMLHttpRequest();
      // `false` makes the request synchronous
      request.open("POST", channel.baseUrl + "/read", false);
      request.send(JSON.stringify({messageId, timeout: checkTimeout}));

      if (request.status === 408) {
        return null;
      } else {
        return JSON.parse(request.responseText);
      }
    };
  }

  while (true) {
    const elapsed = performance.now() - startTime;
    const remaining = totalTimeout - elapsed;
    if (remaining <= 0) {
      return null;
    }

    checkTimeout = Math.min(checkTimeout, remaining);
    const result = check();

    if (result !== null) {
      return result;
    } else if (checkInterrupt?.()) {
      return null;
    }
  }
}
