/* core.js */
"use strict";
/* =========================================================
   CORE — AUTH, STATE, CRYPTO, DB
   - ADMIN / USER SPLIT
   - FILE MASTER KEY
   - DRIVE ROOT AUTHORITY
========================================================= */

(() => {
  /* ===================== LOG ===================== */

  const TS = () => new Date().toISOString();
  window.LOG = (scope, msg, data) =>
    console.log(`[${TS()}] [${scope}] ${msg}`, data ?? "");

  LOG("CORE", "init");

  /* ===================== GLOBAL STATE ===================== */

  window.vaultData = null;
  window.readOnly = true;

  let ADMIN_KEY = null;
  let USER_KEY = null;
  let FILE_KEY = null;

  let DRIVE_ROOT = null;

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
        resolve();
      };
    });
  }

  function dbGet(key) {
    return new Promise(resolve => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result || null);
    });
  }

  function dbPut(key, val) {
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(val, key);
  }

  /* ===================== CRYPTO HELPERS ===================== */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKey(password, salt) {
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
        salt: enc.encode(salt),
        iterations: 150000,
        hash: "SHA-256"
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function aesEncrypt(key, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      bytes
    );
    return { iv: [...iv], data: [...new Uint8Array(buf)] };
  }

  async function aesDecrypt(key, payload) {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
      key,
      new Uint8Array(payload.data)
    );
    return new Uint8Array(buf);
  }

  /* ===================== VAULT SCHEMA ===================== */

  function newVault() {
    return {
      version: 2,
      admin: {
        initialized: false,
        email: null,
        wrappedKey: null
      },
      user: {
        wrappedKey: null
      },
      fileKey: null,
      driveRootId: null,
      createdAt: Date.now()
    };
  }

  /* ===================== UNLOCK (USER) ===================== */

  async function unlockVault(userPassword) {
    const stored = await dbGet("vault");

    // ---------- first run ----------
    if (!stored) {
      const vault = newVault();

      const adminKey = await deriveKey(userPassword, "admin-key");
      const userKey = await deriveKey(userPassword, "user-key");

      const fileKeyRaw = crypto.getRandomValues(new Uint8Array(32));
      const fileKeyCrypto = await crypto.subtle.importKey(
        "raw",
        fileKeyRaw,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      );

      vault.admin.wrappedKey = await aesEncrypt(adminKey, fileKeyRaw);
      vault.user.wrappedKey = await aesEncrypt(userKey, fileKeyRaw);
      vault.fileKey = await aesEncrypt(adminKey, fileKeyRaw);

      dbPut("vault", vault);

      ADMIN_KEY = adminKey;
      USER_KEY = userKey;
      FILE_KEY = fileKeyCrypto;

      window.vaultData = vault;
      window.readOnly = false;

      return true;
    }

    // ---------- existing vault ----------
    try {
      const userKey = await deriveKey(userPassword, "user-key");
      const fileKeyRaw =
        await aesDecrypt(userKey, stored.user.wrappedKey);

      FILE_KEY = await crypto.subtle.importKey(
        "raw",
        fileKeyRaw,
        "AES-GCM",
        false,
        ["encrypt", "decrypt"]
      );

      USER_KEY = userKey;
      ADMIN_KEY = null;

      DRIVE_ROOT = stored.driveRootId || null;

      window.vaultData = stored;
      window.readOnly = false;

      return true;
    } catch {
      throw new Error("wrong-password");
    }
  }

  /* ===================== ADMIN VERIFY ===================== */

  async function verifyAdmin(adminPassword) {
    if (!vaultData?.admin?.wrappedKey)
      throw new Error("no-admin");

    const adminKey = await deriveKey(adminPassword, "admin-key");
    const fileKeyRaw =
      await aesDecrypt(adminKey, vaultData.admin.wrappedKey);

    FILE_KEY = await crypto.subtle.importKey(
      "raw",
      fileKeyRaw,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    );

    ADMIN_KEY = adminKey;
    window.readOnly = false;
  }

  function isAdmin() {
    return !!ADMIN_KEY;
  }

  function setAdmin(email) {
    vaultData.admin.initialized = true;
    vaultData.admin.email = email;
    dbPut("vault", vaultData);
  }

  /* ===================== USER PASSWORD ROTATION ===================== */

  async function rotateUserPassword(newPassword) {
    if (!ADMIN_KEY) throw new Error("not-admin");

    const newUserKey = await deriveKey(newPassword, "user-key");
    const fileKeyRaw =
      await aesDecrypt(ADMIN_KEY, vaultData.fileKey);

    vaultData.user.wrappedKey =
      await aesEncrypt(newUserKey, fileKeyRaw);

    USER_KEY = newUserKey;
    dbPut("vault", vaultData);
  }

  /* ===================== DRIVE ROOT ===================== */

  function setDriveRoot(id) {
    DRIVE_ROOT = id;
    vaultData.driveRootId = id;
    dbPut("vault", vaultData);
  }

  function driveRoot() {
    return DRIVE_ROOT;
  }

  /* ===================== FILE CRYPTO ===================== */

  async function encryptForFile(text) {
    if (!FILE_KEY) throw new Error("locked");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const buf = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      FILE_KEY,
      enc.encode(text)
    );
    const out = new Uint8Array(iv.length + buf.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(buf), iv.length);
    return out;
  }

  async function decryptForFile(bytes) {
    if (!FILE_KEY || !bytes) return "";
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      FILE_KEY,
      data
    );
    return dec.decode(buf);
  }

  /* ===================== EXPORT ===================== */

  window.core = {
    unlockVault,
    verifyAdmin,
    rotateUserPassword,
    isAdmin,
    setAdmin,
    setDriveRoot,
    driveRoot,
    encryptForFile,
    decryptForFile
  };

  openDB();
})();
