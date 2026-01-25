"use strict";

/* =========================================================
   CORE — STATE, CRYPTO, DB, LOGGING
   (NO DOM ACCESS HERE)
========================================================= */

(() => {
  /* ===================== LOGGING ===================== */

  const TS = () => new Date().toISOString();
  window.LOG = (scope, action, data) => {
    if (data !== undefined) {
      console.log(`[${TS()}] [${scope}] ${action}`, data);
    } else {
      console.log(`[${TS()}] [${scope}] ${action}`);
    }
  };

  LOG("CORE", "init");

  /* ===================== STATE ===================== */

  window.APP_STATE = {
    unlocked: false,

    admin: {
      initialized: false,
      email: null
    },

    drive: {
      connected: false,
      rootId: null
    },

    currentFileId: null
  };
  window.vaultData = null;
  window.MASTER_PASSWORD = null;


  /* ===================== CONFIG ===================== */

  const DB_NAME = "securetext";
  const STORE = "vault";
  const AUTO_LOCK_MS = 60_000;

  let db = null;
  let lockTimer = null;

  /* ===================== DB ===================== */

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

  function dbPut(key, val) {
    LOG("DB", "put", key);
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put(val, key);
  }

  function dbGet(key) {
    LOG("DB", "get", key);
    return new Promise(resolve => {
      const req = db.transaction(STORE)
        .objectStore(STORE)
        .get(key);
      req.onsuccess = () => resolve(req.result || null);
    });
  }

  /* ===================== CRYPTO ===================== */

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function deriveKey(password) {
    LOG("CRYPTO", "deriveKey:start");
    const base = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: enc.encode("securetext"),
        iterations: 150000,
        hash: "SHA-256"
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    LOG("CRYPTO", "deriveKey:done");
    return key;
  }

  async function encrypt(password, obj) {
    LOG("CRYPTO", "encrypt:start");
    const key = await deriveKey(password);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode(JSON.stringify(obj))
    );
    LOG("CRYPTO", "encrypt:done");
    return { iv: [...iv], data: [...new Uint8Array(cipher)] };
  }

  async function decrypt(password, payload) {
    LOG("CRYPTO", "decrypt:start");
    const key = await deriveKey(password);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
      key,
      new Uint8Array(payload.data)
    );
    LOG("CRYPTO", "decrypt:done");
    return JSON.parse(dec.decode(plain));
  }

  /* ===================== VAULT ===================== */

  function defaultVault() {
    return {
      admin: {
        initialized: false,
        email: null
      },
      drive: {
        rootId: null
      },
      updatedAt: Date.now()
    };
  }

  async function unlockVault(password) {
    LOG("CORE", "unlock:start");

    const cached = await dbGet("vault");

    if (!cached || !cached.iv || !cached.data) {
      LOG("CORE", "vault:reset");
      window.vaultData = defaultVault();
      MASTER_PASSWORD = password;
      await saveVault(password);
      return;
    }

    try {
      window.vaultData = await decrypt(password, cached);
      MASTER_PASSWORD = password;
      LOG("CORE", "unlock:success");
    } catch {
      LOG("CORE", "vault:decrypt-failed -> reset");
      window.vaultData = defaultVault();
      MASTER_PASSWORD = password;
      await saveVault(password);
    }
  }


  async function saveVault(password) {
    const payload = {
      admin: APP_STATE.admin,
      drive: APP_STATE.drive,
      updatedAt: Date.now()
    };

    const encrypted = await encrypt(password, payload);
    dbPut("vault", encrypted);
    LOG("CORE", "save:local-complete");
  }

  /* ===================== AUTO LOCK ===================== */

  function resetAutoLock() {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      LOG("CORE", "auto-lock");
      location.reload();
    }, AUTO_LOCK_MS);
  }

  ["keydown","mousedown","mousemove","touchstart"].forEach(e =>
    document.addEventListener(e, resetAutoLock, true)
  );

  /* ===================== ADMIN HELPERS ===================== */

  function isAdmin() {
    return APP_STATE.admin.initialized === true;
  }

  function setAdmin(email) {
    APP_STATE.admin.initialized = true;
    APP_STATE.admin.email = email;
    LOG("CORE", "admin:set", email);
  }

  function setDriveRoot(id) {
    APP_STATE.drive.connected = true;
    APP_STATE.drive.rootId = id;
    LOG("CORE", "drive:root-set", id);
  }

  /* ===================== EXPORTS ===================== */

  window.core = {
    openDB,
    unlockVault,
    saveVault,
    encrypt,
    decrypt,
    isAdmin,
    setAdmin,
    setDriveRoot
  };

  /* ===================== INIT ===================== */

  openDB();
})();

/* ================= ADMIN VERIFY ================= */

window.core.verifyAdmin = async function (password) {
  if (password !== "test") {
    LOG("CORE", "admin:verify-fail");
    throw new Error("Not admin");
  }
  LOG("CORE", "admin:verify-ok");
};

/* ================= DRIVE ROOT GETTER ================= */

window.core.driveRoot = function () {
  return APP_STATE.drive.rootId;
};

