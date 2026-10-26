"use strict";
// Twee manieren om Thuisaccu te draaien. Met de lokale server (cargo run) gaan API-verzoeken
// naar die server. In de browserversie (tools/build-site.sh, bijvoorbeeld op GitHub Pages)
// beantwoordt een webworker ze met dezelfde API als WebAssembly, en staat de database in
// IndexedDB in deze browser. index.html zegt welke van de twee: data-backend="server|browser".
window.Local = (() => {
  const enabled = document.documentElement.dataset.backend === "browser";
  const pending = new Map(), LOCK = "thuisaccu-database";
  let worker = null, sequence = 0, held = !navigator.locks, claiming = null;

  // Eén tabblad tegelijk werkt met de database: elk tabblad houdt een eigen kopie in het geheugen en
  // bewaart die in zijn geheel, dus twee tabbladen zouden elkaars wijzigingen overschrijven. Een tweede
  // tabblad wacht (met een melding) tot het eerste sluit. Het slot hoort bij de pagina en niet bij de
  // worker: een worker die na een fout herstart, geeft de database zo niet aan een ander tabblad.
  function claim() {
    claiming ??= held ? Promise.resolve() : new Promise(resolve => {
      const hold = () => { held = true; banner("elsewhere", null); resolve(); return new Promise(() => {}); };
      navigator.locks.request(LOCK, { ifAvailable: true }, lock => {
        if (lock) return hold();
        banner("elsewhere", "Thuisaccu is al open in een ander tabblad van deze browser. Sluit dat tabblad om hier verder te " +
          "gaan; twee tabbladen tegelijk zouden elkaars wijzigingen overschrijven.");
        navigator.locks.request(LOCK, hold);
        return null;
      });
    });
    return claiming;
  }

  function fail(message) {
    for (const job of pending.values()) job.reject(new Error(message));
    pending.clear(); worker?.terminate(); worker = null;
  }

  function call(message, transfer = []) {
    if (!worker) {
      const created = worker = new Worker("worker.js", { type: "module" });
      claim().then(() => created.postMessage({ type: "owner" }));
      worker.onmessage = ({ data }) => {
        // De worker is na een fout in de module gestopt; het volgende verzoek start een nieuwe.
        if (data.restart) { banner("unsaved", null); fail(data.error); return; }
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data);
      };
      worker.onerror = event => { event.preventDefault(); fail("De rekenmodule in deze browser kon niet starten."); };
    }
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...message, id }, transfer);
    });
  }

  // Zelfde vorm als fetch(): een Request erin (ook FormData), een Response eruit.
  async function localFetch(url, init = {}) {
    const request = new Request(new URL(url, location.origin), init);
    const target = new URL(request.url);
    const body = ["GET", "HEAD"].includes(request.method) ? new ArrayBuffer(0) : await request.arrayBuffer();
    const reply = await call({ type: "request", method: request.method, path: target.pathname + target.search,
      contentType: request.headers.get("content-type"), body }, [body]);
    if (reply.unsaved !== undefined) banner("unsaved", reply.unsaved);
    const empty = [204, 205, 304].includes(reply.status);
    return new Response(empty ? null : reply.body,
      { status: reply.status, headers: reply.contentType ? { "content-type": reply.contentType } : {} });
  }

  // Blijvende melding bovenaan: een wijziging die niet in IndexedDB staat (`unsaved`, weg na een geslaagde
  // opslag) of de database die in een ander tabblad open is (`elsewhere`). Zonder tekst verdwijnt hij.
  function banner(id, message) {
    let element = document.getElementById(id);
    if (!message) { element?.remove(); return; }
    if (!element) {
      element = Object.assign(document.createElement("p"), { id, className: "banner" });
      element.setAttribute("role", "alert");
      document.getElementById("main")?.prepend(element);
    }
    element.textContent = message;
  }

  // Een kopie van de database als SQLite-bestand, hetzelfde formaat als data/research.sqlite3.
  async function backup() {
    const { bytes } = await call({ type: "export" });
    return new Blob([bytes], { type: "application/vnd.sqlite3" });
  }

  // Vervangt de database in deze browser; een ongeldig bestand laat de huidige gegevens staan.
  async function restore(file) {
    if (!held) throw new Error("Thuisaccu is open in een ander tabblad; sluit dat eerst.");
    const bytes = await file.arrayBuffer();
    await call({ type: "restore", bytes }, [bytes]);
  }

  const persisted = async () => Boolean(await navigator.storage?.persisted?.());
  const persist = async () => Boolean(await navigator.storage?.persist?.());

  // Waar bewaarde gegevens staan, voor teksten in de interface.
  const where = enabled ? "in deze browser" : "op deze computer";

  return { enabled, where, fetch: localFetch, backup, restore, persisted, persist };
})();
