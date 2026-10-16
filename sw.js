const CACHE_NAME = "ready2go-shell-v0.4.1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./assets/r2g-app-icon.svg",
  "./assets/r2g-app-icon-192.png",
  "./assets/r2g-app-icon-512.png",
  "./assets/r2g-study-hero.png",
  "./assets/r2g-approved-logo-concept.png",
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
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
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
