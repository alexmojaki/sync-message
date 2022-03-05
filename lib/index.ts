const BASE_URL_SUFFIX = "__SyncMessageServiceWorkerInput__";
const VERSION = "__sync-message-v2__";

interface ServiceWorkerReadRequest {
  messageId: string;
  timeout: number;
}

interface ServiceWorkerWriteRequest {
  messageId: string;
  message: string;
}

interface ServiceWorkerResponse {
  message: any;
  version: string;
}

export function serviceWorkerFetchListener(): (e: FetchEvent) => boolean {
  const earlyMessages: { [messageId: string]: any } = {};
  const resolvers: { [messageId: string]: (r: Response) => void } = {};

  return (e: FetchEvent): boolean => {
    const {url} = e.request;
    if (!url.includes(BASE_URL_SUFFIX)) {
      return false;
    }

    async function respond(): Promise<Response> {
      function success(message: any) {
        const response: ServiceWorkerResponse = {message, version: VERSION};
        return new Response(JSON.stringify(response), {status: 200});
      }

      if (url.endsWith("/read")) {
        const {messageId, timeout}: ServiceWorkerReadRequest = await e.request.json();
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
        const {message, messageId}: ServiceWorkerWriteRequest = await e.request.json();
        const resolver = resolvers[messageId];
        if (resolver) {
          resolver(success(message));
          delete resolvers[messageId];
        } else {
          earlyMessages[messageId] = message;
        }
        return success({early: !resolver});
      } else if (url.endsWith("/version")) {
        return new Response(VERSION, {status: 200});
      }
    }

    e.respondWith(respond());
    return true;
  };
}

export function asyncSleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AtomicsChannelOptions {
  bufferSize?: number;
}

export interface ServiceWorkerChannelOptions {
  timeout?: number;
  scope?: string;
}

export interface AtomicsChannel {
  type: "atomics";
  data: Uint8Array;
  meta: Int32Array;
}

export interface ServiceWorkerChannel {
  type: "serviceWorker";
  baseUrl: string;
  timeout: number;
}

export class ServiceWorkerError extends Error {
  constructor(public url: string, public status: number) {
    super(`Received status ${status} from ${url}. Ensure the service worker is registered and active.`);
    // See https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work for info about this workaround.
    Object.setPrototypeOf(this, ServiceWorkerError.prototype);
  }
}

export type Channel = AtomicsChannel | ServiceWorkerChannel;

export function writeMessageAtomics(channel: AtomicsChannel, message: any) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(JSON.stringify(message));
  const {data, meta} = channel;
  if (bytes.length > data.length) {
    throw new Error("Message is too big, increase bufferSize when making channel.");
  }
  data.set(bytes, 0);
  Atomics.store(meta, 0, bytes.length);
  Atomics.store(meta, 1, 1);
  Atomics.notify(meta, 1);
}

export async function writeMessageServiceWorker(channel: ServiceWorkerChannel, message: any, messageId: string) {
  await navigator.serviceWorker.ready;
  const url = channel.baseUrl + "/write";
  const startTime = Date.now();
  while (true) {
    const request: ServiceWorkerWriteRequest = {message, messageId};
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(request),
    });
    if (response.status === 200 && (await response.json()).version === VERSION) {
      return;
    }
    if (Date.now() - startTime < channel.timeout) {
      await asyncSleep(100);
      continue;
    }
    throw new ServiceWorkerError(url, response.status);
  }
}

export async function writeMessage(channel: Channel, message: any, messageId: string) {
  if (channel.type === "atomics") {
    writeMessageAtomics(channel, message);
  } else {
    await writeMessageServiceWorker(channel, message, messageId);
  }
}

export function makeChannel(
  options: { atomics?: AtomicsChannelOptions, serviceWorker?: ServiceWorkerChannelOptions } = {}
): Channel | null {
  if (typeof SharedArrayBuffer !== "undefined") {
    return makeAtomicsChannel(options.atomics);
  } else if ("serviceWorker" in navigator) {
    return makeServiceWorkerChannel(options.serviceWorker);
  } else {
    return null;
  }
}

export function makeAtomicsChannel(
  {bufferSize}: AtomicsChannelOptions = {}
): AtomicsChannel {
  const data = new Uint8Array(
    new SharedArrayBuffer(bufferSize || 128 * 1024),
  );
  const meta = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2),
  );
  return {type: "atomics", data, meta};
}

export function makeServiceWorkerChannel(
  options: ServiceWorkerChannelOptions = {}
): ServiceWorkerChannel {
  const baseUrl = (options.scope || "/") + BASE_URL_SUFFIX;
  return {type: "serviceWorker", baseUrl, timeout: options.timeout || 5000};
}

function ensurePositiveNumber(n: number, defaultValue: number) {
  return n > 0 ? +n : defaultValue;
}

export function readMessage(channel: Channel, messageId: string, {
  checkInterrupt,
  checkTimeout,
  timeout
}: {
  checkInterrupt?: () => boolean;
  checkTimeout?: number;
  timeout?: number;
} = {}) {
  const startTime = performance.now();

  checkTimeout = ensurePositiveNumber(checkTimeout, checkInterrupt ? 100 : 5000);
  const totalTimeout = ensurePositiveNumber(timeout, Number.POSITIVE_INFINITY);
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
      const requestBody: ServiceWorkerReadRequest = {messageId, timeout: checkTimeout};
      request.send(JSON.stringify(requestBody));
      const {status} = request;

      if (status === 408) {
        return null;
      } else if (status === 200) {
        const response = JSON.parse(request.responseText);
        if (response.version !== VERSION) {
          return null;
        }
        return response.message;
      } else if (performance.now() - startTime < channel.timeout) {
        return null;
      } else {
        throw new ServiceWorkerError(url, status);
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
  ms = ensurePositiveNumber(ms, 0);
  if (!ms) {
    return;
  }

  if (typeof SharedArrayBuffer !== "undefined") {
    const arr = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
    );
    arr[0] = 0;
    Atomics.wait(arr, 0, 0, ms);
  } else {
    const messageId = `sleep ${ms} ${uuidv4()}`;
    readMessage(channel, messageId, {timeout: ms});
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
