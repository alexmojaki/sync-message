# sync-message

[![GitHub license](https://img.shields.io/github/license/alexmojaki/sync-message?style=flat)](https://github.com/alexmojaki/sync-message/blob/master/LICENSE) [![Tests](https://github.com/alexmojaki/sync-message/workflows/CI/badge.svg)](https://github.com/alexmojaki/sync-message/actions)

[![NPM](https://nodei.co/npm/sync-message.png)](https://npmjs.org/package/sync-message)

A small library for synchronous communication between the main browser thread and web workers using `Atomics` and/or service workers. In particular you can use the `readMessage` function inside a web worker to **synchronously** receive data from the browser thread.

## Usage outline

1. Setup your application to support at least one of the two types of channel:
   - To enable channels using `Atomics` and `SharedArrayBuffer`, [enable cross-origin isolation](https://web.dev/cross-origin-isolation-guide/#enable-cross-origin-isolation). Note that even with cross-origin isolation, browser support is still shaky.
   - To enable channels using service workers, register a service worker script which uses this library's [`serviceWorkerFetchListener`](#serviceworkerfetchlistener).
2. Create a channel object with [`makeChannel`](#makechannel).
3. Send the channel object to your web worker via the standard `postMessage` or your favourite wrapper library such as `Comlink`.
4. When the worker needs to get data from the main thread:
   1. In the worker, send a unique `messageId` string back to the main thread, again with the usual `postMessage` etc. The function `uuidv4` is provided to make this easy.
   2. Still in the worker, call [`readMessage(channel, messageId, options)`](#readmessage) which will block until it receives and returns a message.
   3. In the main thread, use the `messageId` sent in step 1 to call [`writeMessage(channel, message, messageId)`](#writemessage). `message` will be encoded and decoded using `JSON`.

So your code in the main thread should look something like this:

```js
import {makeChannel, writeMessage} from "sync-message";

const channel = makeChannel();

// If you want to use a service worker channel
navigator.serviceWorker.register("service-worker.js");

// Send the channel to the web worker
worker.postMessage({channel});

// Receive a messageId from the worker and write a message when you're ready
writeMessage(channel, message, messageId);
```

In your web worker:

```js
import {readMessage, uuidv4} from "sync-message";

// Generate a unique messageId string
const messageId = uuidv4();

// Send it to the main thread so that they can call writeMessage as above
postMessage({messageId});

// Receive the message passed to  writeMessage
const message = readMessage(channel, messageId);
```

In your service worker script if you have one:

```js
import {serviceWorkerFetchListener} from "sync-message";

const fetchListener = serviceWorkerFetchListener();

addEventListener("fetch", function (e) {
  if (fetchListener(e)) {
    // This event has been handled by this library
    return;
  }
  // Otherwise, add your own service worker logic here,
  // e.g. passthrough to a normal network request:
  e.respondWith(fetch(e.request));
});
```

## Reference

### `makeChannel`

Accepts one optional argument `options` with two optional keys for configuring the different types of channel:

- `atomics` has one option:
  - `bufferSize`: number of bytes to allocate for the `SharedArrayBuffer`. Defaults to 128KiB. `writeMessage` will throw an error if the message is larger than the buffer size.
- `serviceWorker` has the following options:
  - `scope`: a string representing the prefix of a path/URL, defaulting to `"/"`. Both `readMessage` and `writeMessage` will make requests that start with this value so make sure that your service worker is controlling the page and can intercept those requests. The `scope` property of the registration object returned by `navigator.serviceWorker.register` should work.
  - `timeout`: number of milliseconds representing a grace period for the service worker to start up. If requests made by `readMessage` and `writeMessage` fail, they will be retried until this timeout is exceeded, at which point they will throw an error.

If `SharedArrayBuffer` is available, `makeChannel` will use it to create an `atomics` type channel. Otherwise, if `navigator.serviceWorker` is available, it will create a `serviceWorker` type channel, but registering the service worker is up to you. If that's not available either, it'll return `null`.

Channel objects have a `type` property which is either `"atomics"` or `"serviceWorker"`. The other properties are for internal use.

If you want to control the type of channel, you can call `makeAtomicsChannel({bufferSize?})` or `makeServiceWorkerChannel({scope?, timeout?})` directly.

A single channel object shouldn't be used by multiple workers simultaneously, i.e. you should only read/write one message at a time.

### `writeMessage`

Call this in the browser's main UI thread to send a message to the worker reading from the channel with `readMessage`. Takes three arguments:

- `channel`: a non-null object returned by `makeChannel`, `makeAtomicsChannel`, or `makeServiceWorkerChannel`.
- `message`: any object that can be safely passed to `JSON.stringify` and then decoded with `JSON.parse`.
- `messageId`: a unique string identifying the message that the worker is waiting for. Currently only used by service worker channels.

### `readMessage`

Call this in a web worker to synchronously receive a message sent by the main thread with `writeMessage`. Takes three arguments:

- `channel`: a non-null object returned by `makeChannel`, `makeAtomicsChannel`, or `makeServiceWorkerChannel`. Should be created once in the main thread and then sent to the worker.
- `messageId`: a unique string identifying the message that the worker is waiting for. Currently only used by service worker channels. Typically created in the worker using the `uuidv4` function and then sent to the main thread *before* calling `readMessage`.
- `options`: an optional object with the following optional keys:
  - `timeout`: a number of milliseconds. If this much time elapses without receiving a message, `readMessage` will return `null`.
  - `checkInterrupt`: a function which may be called regularly while `readMessage` is checking for messages on the channel. If it returns `true`, then `readMessage` will return `null`.

### `serviceWorkerFetchListener`

Call this once in a service worker script. Returns a function which accepts a fetch event and responds to requests made by `readMessage` and `writeMessage`. If you don't need to use a service worker for anything else, you can simply write:

```js
addEventListener("fetch", serviceWorkerFetchListener());
```

Otherwise, create a listener function *once* and then reuse it:

```js
import {serviceWorkerFetchListener} from "sync-message";

const fetchListener = serviceWorkerFetchListener();

addEventListener("fetch", function (e) {
  if (fetchListener(e)) {
    // This event has been handled by this library
    return;
  }
  // Otherwise, add your own service worker logic here,
  // e.g. passthrough to a normal network request:
  e.respondWith(fetch(e.request));
});
```
