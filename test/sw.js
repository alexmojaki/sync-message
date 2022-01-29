import * as lib from "../lib";

const fetchListener = lib.serviceWorkerFetchListener({readTimeout: 10});

addEventListener("fetch", function (e) {
  if (fetchListener(e)) {
    return;
  }
  e.respondWith(fetch(e.request));
});

addEventListener("install", function (e) {
  e.waitUntil(self.skipWaiting());
});

addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});
