// Webworker van de browserversie (zie local.js). Laadt de WebAssembly-module met de API en
// SQLite (crates/browser), en bewaart de database na elke geslaagde wijziging in IndexedDB.
// Alleen in de statische site; de lokale server levert dit bestand niet.
import init, { open, request, snapshot } from "./pkg/thuisaccu_browser.js";

const DATABASE = "thuisaccu", STORE = "bestanden", KEY = "research.sqlite3";

function stored(mode, action) {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, tx = db.transaction(STORE, mode), result = action(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(result.result); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

// Opslaan gebeurt na elkaar, zodat een oudere kopie nooit een nieuwere overschrijft.
let saving = Promise.resolve();
function save() {
  const bytes = snapshot();
  saving = saving.catch(() => {}).then(() => stored("readwrite", store => store.put(bytes, KEY)));
  return saving;
}

const loaded = init();
let ready = loaded.then(async () => open((await stored("readonly", store => store.get(KEY))) ?? undefined))
  .catch(error => { throw new Error(`De database in deze browser kon niet worden geopend: ${error?.message ?? error}`); });

self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (data.type === "request") {
      await ready;
      const reply = await request(data.method, data.path, data.contentType ?? undefined, new Uint8Array(data.body));
      const { status, contentType, body } = reply;
      reply.free();
      // Het antwoord volgt pas als de wijziging bewaard is; een mislukte wijziging is al teruggerold.
      if (!["GET", "HEAD"].includes(data.method) && status < 400) await save();
      self.postMessage({ id, status, contentType, body: body.buffer }, [body.buffer]);
    } else if (data.type === "export") {
      await ready;
      const bytes = snapshot();
      self.postMessage({ id, bytes: bytes.buffer }, [bytes.buffer]);
    } else if (data.type === "restore") {
      await loaded;
      await open(new Uint8Array(data.bytes));
      ready = Promise.resolve();
      await save();
      self.postMessage({ id });
    }
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
