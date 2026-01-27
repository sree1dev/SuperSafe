/* core.js */
"use strict";
/* =========================================================
   CORE — AUTH, STATE, CRYPTO, DB (AGGRESSIVE CACHE)
========================================================= */

(() => {
  /* ===================== LOG ===================== */

  const TS = () => new Date().toISOString();
  window.LOG = (scope, msg, data) => {
    console.log(
      `[${TS()}] [${scope}] ${msg}`,
      data !== undefined ? data : ""
    );
  };

  LOG("CORE", "init");

  /* ===================== GLOBAL STATE ===================== */

  window.vaultData = null;
  window.readOnly = true;

  let MASTER_PASSWORD = null;
  let UNLOCKED = false;

  /* ===================== IN-MEMORY CACHES ===================== */
  /* Cleared on reload / auto-lock */

  const decryptedFileCache = new Map(); // fileId -> html string
  const encryptedFileCache = new Map(); // fileId -> Uint8Array

  function clearCaches() {
    decryptedFileCache.clear();
    encryptedFileCache.clear();
    LOG("CORE", "cache:cleared");
  }

  /* ===================== DB ===================== */

  const DB_NAME = "securetext";
  const STORE = "vault";
  let db = null;

  function openDB() {
    return new Promise(resolve => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e =>
        e.target.result.createObjectStore(STORE);
      req.onsuccess = e => {
        db = e.target.result;
        LOG("DB", "open");
        resolve();
      };
    });
  }

  function dbGet(key) {
    LOG("DB", "get", key);
    return new Promise(resolve => {
      const req = db
        .transaction(STORE)
        .objectStore(STORE)
        .get(key);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  function dbPut(key, val) {
    LOG("DB", "put", key);
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(val, key);
  }

  /* ===================== CRYPTO ===================== */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKey(password) {
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("securetext-v1"),
        iterations: 150000,
        hash: "SHA-256"
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(password, obj) {
    const key = await deriveKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(obj))
    );
    return { iv: [...iv], data: [...new Uint8Array(buf)] };
  }

  async function decrypt(password, payload) {
    const key = await deriveKey(password);
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
      key,
      new Uint8Array(payload.data)
    );
    return JSON.parse(dec.decode(buf));
  }

  /* ===================== VAULT ===================== */

  function newVault() {
    return {
      admin: {
        initialized: false,
        email: null
      },
      createdAt: Date.now()
    };
  }

  async function unlockVault(password) {
    LOG("CORE", "unlock:start");

    if (!password) throw new Error("empty-password");

    const stored = await dbGet("vault");

    if (!stored) {
      vaultData = newVault();
      MASTER_PASSWORD = password;
      UNLOCKED = true;
      readOnly = false;

      const encrypted = await encrypt(password, vaultData);
      dbPut("vault", encrypted);

      LOG("CORE", "unlock:first-run");
      return true;
    }

    try {
      vaultData = await decrypt(password, stored);
      MASTER_PASSWORD = password;
      UNLOCKED = true;
      readOnly = !vaultData.admin.initialized;

      LOG("CORE", "unlock:success");
      return true;
    } catch {
      LOG("CORE", "unlock:wrong-password");
      throw new Error("wrong-password");
    }
  }

  async function saveVault() {
    if (!UNLOCKED) throw new Error("vault-locked");
    const encrypted = await encrypt(MASTER_PASSWORD, vaultData);
    dbPut("vault", encrypted);
    LOG("CORE", "vault:saved");
  }

  /* ===================== ADMIN ===================== */

  function isAdmin() {
    return vaultData?.admin?.initialized === true;
  }

  async function verifyAdmin(password) {
    if (!UNLOCKED || password !== MASTER_PASSWORD) {
      throw new Error("not-admin");
    }
  }

  function setAdmin(email) {
    vaultData.admin.initialized = true;
    vaultData.admin.email = email;
    readOnly = false;
    saveVault();
  }

  /* ===================== DRIVE ROOT ===================== */

  let DRIVE_ROOT = null;

  function setDriveRoot(id) {
    DRIVE_ROOT = id;
    LOG("CORE", "drive:root-set", id);
  }

  function driveRoot() {
    return DRIVE_ROOT;
  }

  /* ===================== FILE CONTENT (CACHED) ===================== */

  async function encryptForFile(htmlString, fileId) {
    if (!UNLOCKED) throw new Error("vault-locked");

    const key = await deriveKey(MASTER_PASSWORD);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = enc.encode(htmlString);

    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    const out = new Uint8Array(iv.length + buf.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(buf), iv.length);

    if (fileId) {
      decryptedFileCache.set(fileId, htmlString);
      encryptedFileCache.set(fileId, out);
      LOG("CORE", "file:cache-update", fileId);
    }

    return out;
  }

  async function decryptForFile(bytes, fileId) {
    if (!UNLOCKED || !bytes || bytes.length < 13) return "";

    if (fileId && decryptedFileCache.has(fileId)) {
      LOG("CORE", "file:cache-hit", fileId);
      return decryptedFileCache.get(fileId);
    }

    LOG("CORE", "file:cache-miss", fileId);

    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const key = await deriveKey(MASTER_PASSWORD);

    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );

    const text = dec.decode(buf);

    if (fileId) {
      decryptedFileCache.set(fileId, text);
      encryptedFileCache.set(fileId, bytes);
      LOG("CORE", "file:cache-store", fileId);
    }

    return text;
  }

  /* ===================== AUTO LOCK ===================== */

  const AUTO_LOCK_MS = 60_000;
  let lockTimer = null;

  function resetAutoLock() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      LOG("CORE", "auto-lock");
      clearCaches();
      location.reload();
    }, AUTO_LOCK_MS);
  }

  ["mousemove","keydown","mousedown","touchstart"].forEach(e =>
    document.addEventListener(e, resetAutoLock, true)
  );

  /* ===================== EXPORT ===================== */

  window.core = {
    unlockVault,
    saveVault,
    isAdmin,
    verifyAdmin,
    setAdmin,
    setDriveRoot,
    driveRoot,
    encryptForFile,
    decryptForFile,
    clearCaches
  };

  /* ===================== INIT ===================== */

  openDB();
})();
