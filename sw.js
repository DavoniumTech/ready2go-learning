const CACHE_NAME = "ready2go-shell-v0.2.0";
const APP_SHELL = [
  "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./assets/r2g-app-icon.svg",
  "./assets/r2g-app-icon-192.png", "./assets/r2g-app-icon-512.png", "./js/app.js", "./js/store.js",
  "./js/firebase.js", "./js/firebase-config.js", "./data/subjects.json", "./data/manifest.json",
  "./data/mathematics.json", "./data/use-of-english.json", "./privacy.html", "./terms.html"
];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("ready2go-shell-")&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch", event => {
  const req=event.request; const url=new URL(req.url);
  if(req.method!=="GET" || url.origin!==self.location.origin) return;
  if(req.mode==="navigate") {
    event.respondWith(fetch(req).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put("./index.html",copy));return response;}).catch(()=>caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy));}return response;})));
});
