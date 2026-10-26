// Webworker van de browserversie (zie local.js). Laadt de WebAssembly-module met de API en
// SQLite (crates/browser), en bewaart de database na elke geslaagde wijziging in IndexedDB. Een
// verzoek schrijft alleen weg als de database sinds de laatste geslaagde opslag veranderde; een
// mislukte opslag wordt bij het volgende verzoek dus opnieuw geprobeerd.
// Alleen in de statische site; de lokale server levert dit bestand niet.
import init, { changes, open, request, restore, snapshot } from "./pkg/thuisaccu_browser.js";

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

// Opslaan gebeurt na elkaar, zodat een oudere kopie nooit een nieuwere overschrijft. `savedAt` is de
// wijzigingsteller van de laatst bewaarde kopie.
let saving = Promise.resolve(), savedAt = null;
function save() {
  const bytes = snapshot(), at = changes();
  saving = saving.catch(() => {}).then(() => stored("readwrite", store => store.put(bytes, KEY)))
    .then(() => { savedAt = at; });
  return saving;
}

const loaded = init();
let ready = loaded.then(async () => { await open((await stored("readonly", store => store.get(KEY))) ?? undefined); savedAt = changes(); })
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
      // Mislukt het bewaren, dan is de wijziging wel gedaan (in het geheugen): het antwoord gaat mee,
      // met `unsaved`, zodat de interface waarschuwt in plaats van een geslaagde actie fout te noemen.
      let unsaved;
      if (!["GET", "HEAD"].includes(data.method) && status < 400 && changes() !== savedAt) {
        unsaved = await save().then(() => null, error =>
          `Je laatste wijziging staat nog niet blijvend in deze browser (${error?.message ?? error}). ` +
          "Maak een back-up voordat je dit tabblad sluit; bij de volgende wijziging wordt opnieuw opgeslagen.");
      }
      self.postMessage({ id, status, contentType, body: body.buffer, unsaved }, [body.buffer]);
    } else if (data.type === "export") {
      // Kan de bewaarde database niet worden geopend, dan krijg je hem toch mee zoals hij in de browser
      // staat, zodat je je gegevens niet kwijt bent; een terugzetten zou hem anders overschrijven.
      const bytes = await ready.then(() => snapshot(), async error => {
        const raw = await stored("readonly", store => store.get(KEY)).catch(() => null);
        if (!raw) throw error;
        return raw;
      });
      self.postMessage({ id, bytes: bytes.buffer }, [bytes.buffer]);
    } else if (data.type === "restore") {
      // Lukt het bewaren niet, dan gaat de vorige database weer open, zodat een volgende wijziging de
      // back-up niet alsnog over je gegevens heen schrijft.
      await loaded;
      const previous = await ready.then(() => snapshot(), () => null), wasReady = ready;
      await restore(new Uint8Array(data.bytes));
      ready = Promise.resolve();
      try { await save(); } catch (error) {
        if (previous) { await open(previous); savedAt = changes(); } else ready = wasReady;
        throw new Error(`De back-up kon niet in deze browser worden bewaard (${error?.message ?? error}).`);
      }
      self.postMessage({ id });
    }
  } catch (error) {
    // Een fout in de module zelf (een paniek in Rust) laat haar in een onbruikbare toestand achter:
    // local.js start een nieuwe worker, die de laatst bewaarde database opnieuw inleest. Een
    // half uitgevoerde wijziging was nog niet bewaard.
    if (error instanceof WebAssembly.RuntimeError) {
      self.postMessage({ id, restart: true,
        error: "Er ging iets mis in Thuisaccu zelf. De laatst bewaarde gegevens zijn opnieuw geladen; probeer het nog eens." });
      self.close();
      return;
    }
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};
