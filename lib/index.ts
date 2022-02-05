const BASE_URL_SUFFIX = "/__SyncMessageServiceWorkerInput__";

export function serviceWorkerFetchListener(): (e: FetchEvent) => boolean {
  const earlyMessages: { [messageId: string]: any } = {};
  const resolvers: { [messageId: string]: (r: Response) => void } = {};

  return (e: FetchEvent): boolean => {
    const {url} = e.request;
    if (!url.includes(BASE_URL_SUFFIX)) {
      return false;
    }

    async function respond(): Promise<Response> {
      function success(d: any) {
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

export function asyncSleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AtomicsChannel {
  type: "atomics";
  data: Uint8Array;
  meta: Int32Array;
}

export interface ServiceWorkerChannel {
  type: "serviceWorker";
  baseUrl: string;
}

export type Channel = AtomicsChannel | ServiceWorkerChannel;

export function makeAtomicsChannel(
  {bufferSize}: { bufferSize?: number } = {}
): { channel: AtomicsChannel, writeInput: (inputData: any) => void } {
  const data = new Uint8Array(
    new SharedArrayBuffer(bufferSize || 128 * 1024),
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

export async function makeServiceWorkerChannel(
  options: { timeout?: number } = {}
): Promise<{ channel: ServiceWorkerChannel, writeInput: (inputData: any, messageId: string) => Promise<void> }> {
  const registration = await navigator.serviceWorker.ready;
  const baseUrl = registration.scope + BASE_URL_SUFFIX;

  const timeout = options.timeout || 5000;
  const startTime = Date.now();
  while (true) {
    const response = await fetch(baseUrl + "/version");
    if (response.status === 200 && (await response.text()) === "v1") {
      break;
    }
    if (Date.now() - startTime < timeout) {
      await asyncSleep(100);
    } else {
      return null;
    }
  }

  return {
    channel: {type: "serviceWorker", baseUrl},
    writeInput: async function (data, messageId) {
      const url = baseUrl + "/write";
      const {status} = await fetch(url, {
        method: "POST",
        body: JSON.stringify({data, messageId}),
      });
      if (status !== 200) {
        throw Error(`Received status ${status} from ${url}`);
      }
    },
  };
}

export function readChannel(channel: Channel, messageId: string, {
  checkInterrupt,
  checkTimeout,
  timeout
}: {
  checkInterrupt?: () => boolean;
  checkTimeout?: number;
  timeout?: number;
} = {}) {
  const startTime = performance.now();

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
      const url = channel.baseUrl + "/read";
      request.open("POST", url, false);
      request.send(JSON.stringify({messageId, timeout: checkTimeout}));
      const {status} = request;

      if (status === 408) {
        return null;
      } else if (status === 200) {
        return JSON.parse(request.responseText);
      } else {
        throw Error(`Received status ${status} from ${url}`);
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

export function syncSleep(ms: number, channel: Channel) {
  if (typeof SharedArrayBuffer !== "undefined") {
    const arr = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    );
    arr[0] = 0;
    Atomics.wait(arr, 0, 0, ms);
  } else {
    const messageId = `sleep ${ms} ${uuidv4()}`;
    readChannel(channel, messageId, {timeout: ms});
  }
}

export let uuidv4: () => string;

if ("randomUUID" in crypto) {
  uuidv4 = function uuidv4() {
    return (crypto as any).randomUUID();
  };
} else {
  // https://stackoverflow.com/a/2117523/2482744
  uuidv4 = function uuidv4() {
    return ('10000000-1000-4000-8000-100000000000').replace(/[018]/g, (char) => {
        const c = Number(char);
        return (
          c ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))
        ).toString(16);
      },
    );
  };
}
