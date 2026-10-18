const CACHE_NAME = "ready2go-shell-v1.1.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/r2g-app-icon.svg",
  "./assets/r2g-app-icon-192.png",
  "./assets/r2g-app-icon-512.png",
  "./assets/study-pattern.svg",
  "./assets/study-buddies.webp",
  "./js/app.js",
  "./js/store.js",
  "./js/firebase.js",
  "./js/firebase-config.js",
  "./js/content-config.js",
  "./data/subjects.json",
  "./data/manifest.json",
  "./data/institutions.json",
  "./data/courses.json",
  "./data/cutoff-marks.json",
  "./data/question-archive.json",
  "./privacy.html",
  "./terms.html",
  "./content-policy.html",
  "./data/use-of-english.json",
  "./data/agricultural-science.json",
  "./data/arabic.json",
  "./data/fine-art.json",
  "./data/biology.json",
  "./data/chemistry.json",
  "./data/christian-religious-knowledge.json",
  "./data/commerce.json",
  "./data/economics.json",
  "./data/french.json",
  "./data/geography.json",
  "./data/government.json",
  "./data/hausa.json",
  "./data/history.json",
  "./data/home-economics.json",
  "./data/igbo.json",
  "./data/islamic-studies.json",
  "./data/literature-in-english.json",
  "./data/mathematics.json",
  "./data/music.json",
  "./data/physics.json",
  "./data/principles-of-accounts.json",
  "./data/yoruba.json",
  "./data/computer-studies.json",
  "./data/physical-health-education.json"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const results = await Promise.allSettled(APP_SHELL.map(async path => {
      const response = await fetch(path, { cache: "reload" });
      if (!response.ok) throw new Error(`Precache failed: ${path} (${response.status})`);
      await cache.put(path, response);
    }));
    const failed = results.map((r, i) => r.status === "rejected" ? APP_SHELL[i] : null).filter(Boolean);
    // Do not label the PWA offline-ready if even one bundled subject pack is missing.
    // A subsequent visit while online will retry installation after a failed cache pass.
    if (failed.length) {
      throw new Error(`Ready2Go complete offline cache failed for: ${failed.join(", ")}`);
    }
    await cache.put("./__ready2go_cache_complete__.json", new Response(JSON.stringify({ version: CACHE_NAME, cachedAt: new Date().toISOString(), assets: APP_SHELL.length }), { headers: { "content-type": "application/json" } }));
    await self.skipWaiting();
  })());
});
self.addEventListener("message", event => { if (event.data?.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("ready2go-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
    return response;
  })));
});
