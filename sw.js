/* Cache only this public static shell. Never cache config, API or auth URLs. */
"use strict";
const CACHE = "nectarspend-shell-v3";
const SHELL = [
  "/privacy.html", "/terms.html", "/disclaimer.html", "/css/legal.css",
  "/", "/index.html", "/css/style.css", "/js/pwa.js", "/js/errors.js",
  "/js/backend.js", "/js/core.js", "/js/records.js", "/js/data.js", "/js/app.js",
  "/assets/lucide.min.js", "/assets/supabase.js", "/manifest.webmanifest",
  "/assets/icon-192.png", "/assets/icon-512.png", "/assets/favicon.png",
  "/assets/apple-touch-icon.png"
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  // Let existing tabs finish with their current version before activating updates.
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("nectarspend-shell-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.search || url.hash || request.headers.has("authorization") ||
      !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    // Network first; offline fallback is limited to public files precached at install.
    // Runtime responses are never persisted, including redirects or auth callbacks.
    try { return await fetch(request); }
    catch {
      const cached = await (await caches.open(CACHE)).match(url.pathname);
      return cached || Response.error();
    }
  })());
});
