/* cache.js */
"use strict";
/* =========================================================
   CACHE — FILE CONTENT (ENCRYPTED + DECRYPTED)
   - memory-first
   - idb-backed
   - promise dedup
========================================================= */

(() => {
  const DB_NAME = "securetext";
  const STORE = "vault";

  /* ===================== LOG ===================== */

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

  /* ===================== PUBLIC ===================== */

  async function loadText(fileId) {
    // 🔒 promise de-dup
    if (inFlight.has(fileId)) {
      log("hit:inflight", fileId);
      return inFlight.get(fileId);
    }

    // ⚡ decrypted memory
    if (memDecrypted.has(fileId)) {
      log("hit:mem-dec", fileId);
      refreshInBackground(fileId);
      return memDecrypted.get(fileId);
    }

    const p = loadTextInternal(fileId);
    inFlight.set(fileId, p);

    try {
      const text = await p;
      return text;
    } finally {
      inFlight.delete(fileId);
    }
  }

  async function saveText(fileId, html) {
    memDecrypted.set(fileId, html);

    const encrypted = await core.encryptForFile(html);
    memEncrypted.set(fileId, encrypted);

    idbPut(encKey(fileId), [...encrypted]);
    idbPut(decKey(fileId), html);

    await drive.saveFile(fileId, encrypted);
    log("save", fileId);
  }

  function invalidate(fileId) {
    memEncrypted.delete(fileId);
    memDecrypted.delete(fileId);
    inFlight.delete(fileId);
    idbDel(encKey(fileId));
    idbDel(decKey(fileId));
    log("invalidate", fileId);
  }

  /* ===================== INTERNAL ===================== */

  async function loadTextInternal(fileId) {
    // 🧠 decrypted idb
    const dec = await idbGet(decKey(fileId));
    if (dec) {
      log("hit:idb-dec", fileId);
      memDecrypted.set(fileId, dec);
      refreshInBackground(fileId);
      return dec;
    }

    // 🧠 encrypted memory
    if (memEncrypted.has(fileId)) {
      log("hit:mem-enc", fileId);
      const text = await core.decryptForFile(memEncrypted.get(fileId));
      memDecrypted.set(fileId, text);
      idbPut(decKey(fileId), text);
      refreshInBackground(fileId);
      return text;
    }

    // 🧠 encrypted idb
    const encArr = await idbGet(encKey(fileId));
    if (encArr) {
      log("hit:idb-enc", fileId);
      const bytes = new Uint8Array(encArr);
      memEncrypted.set(fileId, bytes);

      const text = await core.decryptForFile(bytes);
      memDecrypted.set(fileId, text);
      idbPut(decKey(fileId), text);
      refreshInBackground(fileId);
      return text;
    }

    // 🌐 DRIVE (cold)
    log("miss:drive", fileId);
    const bytes = await drive.loadFile(fileId);
    memEncrypted.set(fileId, bytes);
    idbPut(encKey(fileId), [...bytes]);

    const text = await core.decryptForFile(bytes);
    memDecrypted.set(fileId, text);
    idbPut(decKey(fileId), text);

    return text;
  }

  async function refreshInBackground(fileId) {
    try {
      const bytes = await drive.loadFile(fileId);
      memEncrypted.set(fileId, bytes);
      idbPut(encKey(fileId), [...bytes]);

      const text = await core.decryptForFile(bytes);
      memDecrypted.set(fileId, text);
      idbPut(decKey(fileId), text);

      log("bg-refresh", fileId);
    } catch {
      /* silent */
    }
  }

  /* ===================== EXPORT ===================== */

  window.cache = {
    loadText,
    saveText,
    invalidate
  };
})();
