/* cache.js */
"use strict";
/* =========================================================
   CACHE — LOCAL-FIRST · ENCRYPTED · MANUAL SYNC (FINAL)
========================================================= */

(() => {
  const DB_NAME = "securetext";
  const STORE = "vault";

  const log = (m, d) => LOG("CACHE", m, d);

  /* ===================== IDB ===================== */

  function idbGet(key) {
    return new Promise(resolve => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onsuccess = e => {
        const db = e.target.result;
        const g = db.transaction(STORE).objectStore(STORE).get(key);
        g.onsuccess = () => resolve(g.result || null);
      };
    });
  }

  function idbPut(key, val) {
    const r = indexedDB.open(DB_NAME, 1);
    r.onsuccess = e => {
      e.target.result
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put(val, key);
    };
  }

  function idbDel(key) {
    const r = indexedDB.open(DB_NAME, 1);
    r.onsuccess = e => {
      e.target.result
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .delete(key);
    };
  }

  /* ===================== KEYS ===================== */

  const encKey = id => `enc:${id}`;
  const decKey = id => `dec:${id}`;

  /* ===================== MEMORY ===================== */

  const memEncrypted = new Map(); // fileId -> Uint8Array
  const memDecrypted = new Map(); // fileId -> string
  const inFlight = new Map();     // fileId -> Promise<string>

  /* ===================== LOAD ===================== */

  async function loadText(fileId) {
    if (inFlight.has(fileId)) {
      log("hit:inflight", fileId);
      return inFlight.get(fileId);
    }

    if (memDecrypted.has(fileId)) {
      log("hit:mem-dec", fileId);
      return memDecrypted.get(fileId);
    }

    const p = loadInternal(fileId);
    inFlight.set(fileId, p);

    try {
      return await p;
    } finally {
      inFlight.delete(fileId);
    }
  }

  async function loadInternal(fileId) {
    /* ---------- decrypted IDB ---------- */
    const dec = await idbGet(decKey(fileId));
    if (dec !== null) {
      log("hit:idb-dec", fileId);
      memDecrypted.set(fileId, dec);
      return dec;
    }

    /* ---------- encrypted IDB ---------- */
    const encArr = await idbGet(encKey(fileId));
    if (encArr) {
      log("hit:idb-enc", fileId);
      const bytes = new Uint8Array(encArr);
      memEncrypted.set(fileId, bytes);

      const text = await core.decryptForFile(bytes);
      memDecrypted.set(fileId, text);
      idbPut(decKey(fileId), text);
      return text;
    }

    /* ---------- DRIVE (cold bootstrap only) ---------- */
    log("cold:drive", fileId);
    const bytes = await drive.loadFile(fileId);

    memEncrypted.set(fileId, bytes);
    idbPut(encKey(fileId), [...bytes]);

    const text = await core.decryptForFile(bytes);
    memDecrypted.set(fileId, text);
    idbPut(decKey(fileId), text);

    return text;
  }

  /* ===================== SAVE (LOCAL ONLY) ===================== */

  async function saveLocal(fileId, html) {
    memDecrypted.set(fileId, html);

    const encrypted = await core.encryptForFile(html);
    memEncrypted.set(fileId, encrypted);

    idbPut(encKey(fileId), [...encrypted]);
    idbPut(decKey(fileId), html);

    log("save:local", fileId);
  }

  /* ===================== FLUSH ===================== */

  async function flushToDrive(fileId) {
    if (!memEncrypted.has(fileId)) return;
    await drive.saveFile(fileId, memEncrypted.get(fileId));
    log("flush:file", fileId);
  }

  async function flushAll() {
    for (const fileId of memEncrypted.keys()) {
      await flushToDrive(fileId);
    }
    log("flush:all");
  }

  /* ===================== INVALIDATE ===================== */

  function invalidate(fileId) {
    memEncrypted.delete(fileId);
    memDecrypted.delete(fileId);
    inFlight.delete(fileId);
    idbDel(encKey(fileId));
    idbDel(decKey(fileId));
    log("invalidate", fileId);
  }

  /* ===================== EXPORT ===================== */

  window.cache = {
    loadText,
    saveLocal,
    flushToDrive,
    flushAll,
    invalidate
  };
})();
