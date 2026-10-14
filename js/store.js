const DB_NAME = "ready2go-learning";
const DB_VERSION = 1;
let dbPromise;
function openDb() {
  if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable"));
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local storage"));
  });
  return dbPromise;
}
export async function readRecord(key, fallback = null) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction("records", "readonly").objectStore("records").get(key);
      req.onsuccess = () => resolve(req.result?.value ?? fallback);
      req.onerror = () => reject(req.error);
    });
  } catch { try { const raw = localStorage.getItem(`r2g:${key}`); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
}
export async function writeRecord(key, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const req = db.transaction("records", "readwrite").objectStore("records").put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { localStorage.setItem(`r2g:${key}`, JSON.stringify(value)); }
}
export async function deleteRecord(key) {
  try { const db = await openDb(); await new Promise((resolve,reject)=>{const r=db.transaction("records","readwrite").objectStore("records").delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);}); }
  catch { localStorage.removeItem(`r2g:${key}`); }
}
