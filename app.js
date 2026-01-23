/* ================= CONFIG ================= */

let MASTER_PASSWORD = "test";
const AUTO_LOCK_MS = 60_000;

const DB_NAME = "securetext";
const STORE = "vault";

/* ================= ELEMENTS ================= */

const lockScreen = document.getElementById("lockScreen");
const app = document.getElementById("app");
const passwordInput = document.getElementById("passwordInput");
const lockError = document.getElementById("lockError");

const editor = document.getElementById("editor");
const colorPicker = document.getElementById("colorPicker");

const changeModal = document.getElementById("changeModal");
const oldPwd = document.getElementById("oldPwd");
const newPwd = document.getElementById("newPwd");
const newPwd2 = document.getElementById("newPwd2");
const changeError = document.getElementById("changeError");

/* ================= STATE ================= */

let unlocked = false;
let db = null;
let lastEncrypted = null;
let lockTimer = null;

/* ================= LOG ================= */

console.log("[INIT] Vault locked");

/* ================= DB ================= */

function openDB() {
  return new Promise(resolve => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve();
    };
  });
}

function saveEncrypted(payload) {
  db.transaction(STORE, "readwrite").objectStore(STORE).put(payload, "data");
}

function loadEncrypted() {
  return new Promise(resolve => {
    const req = db.transaction(STORE).objectStore(STORE).get("data");
    req.onsuccess = () => resolve(req.result || null);
  });
}

/* ================= CRYPTO ================= */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("securetext"),
      iterations: 150000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptContent(password, html) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(html)
  );
  return { iv: [...iv], data: [...new Uint8Array(cipher)] };
}

async function decryptContent(password, payload) {
  const key = await deriveKey(password);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data)
  );
  return dec.decode(plain);
}

/* ================= UNLOCK ================= */

function unlockVault() {
  if (unlocked) return;

  console.log("[UNLOCK] SUCCESS");
  unlocked = true;

  lockScreen.remove();
  app.classList.remove("hidden");

  resetAutoLock();

  if (lastEncrypted) {
    decryptContent(MASTER_PASSWORD, lastEncrypted).then(html => {
      editor.innerHTML = html;
    });
  }

  editor.focus();
}

/* 🔥 FIXED AUTO-UNLOCK LOGIC 🔥 */
passwordInput.addEventListener("input", () => {
  const typed = passwordInput.value;

  console.log("[TYPE]", typed);

  if (typed.length < MASTER_PASSWORD.length) {
    lockError.textContent = "";
    return;
  }

  if (typed === MASTER_PASSWORD) {
    unlockVault();
  } else {
    lockError.textContent = "Wrong password";
  }
});

/* ================= AUTO LOCK ================= */

function resetAutoLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => {
    console.log("[AUTOLOCK]");
    location.reload();
  }, AUTO_LOCK_MS);
}

["keydown", "mousedown", "mousemove", "touchstart"].forEach(evt =>
  document.addEventListener(evt, resetAutoLock, true)
);

/* ================= FORMATTING ================= */

document.querySelectorAll("[data-cmd]").forEach(btn => {
  btn.onclick = () => {
    document.execCommand(btn.dataset.cmd);
    editor.focus();
  };
});

colorPicker.oninput = () => {
  document.execCommand("foreColor", false, colorPicker.value);
  editor.focus();
};

document.getElementById("bulletBtn").onclick = () => {
  document.execCommand("insertUnorderedList");
};

document.getElementById("numberBtn").onclick = () => {
  document.execCommand("insertOrderedList");
};

document.getElementById("undoBtn").onclick = () => {
  document.execCommand("undo");
};

document.getElementById("redoBtn").onclick = () => {
  document.execCommand("redo");
};

/* ================= BUTTONS ================= */

document.getElementById("encryptBtn").onclick = async () => {
  if (!unlocked) return;
  lastEncrypted = await encryptContent(MASTER_PASSWORD, editor.innerHTML);
  saveEncrypted(lastEncrypted);
  console.log("[ENCRYPT] Saved");
};

document.getElementById("logoutBtn").onclick = () => {
  console.log("[LOGOUT]");
  location.reload();
};

document.getElementById("changePwdBtn").onclick = () => {
  changeModal.classList.remove("hidden");
};

document.getElementById("changeBtn").onclick = async () => {
  if (oldPwd.value !== MASTER_PASSWORD) {
    changeError.textContent = "Wrong current password";
    return;
  }
  if (newPwd.value !== newPwd2.value || !newPwd.value) {
    changeError.textContent = "New passwords do not match";
    return;
  }

  const plaintext = lastEncrypted
    ? await decryptContent(MASTER_PASSWORD, lastEncrypted)
    : editor.innerHTML;

  MASTER_PASSWORD = newPwd.value;
  lastEncrypted = await encryptContent(MASTER_PASSWORD, plaintext);
  saveEncrypted(lastEncrypted);

  changeModal.classList.add("hidden");
  oldPwd.value = newPwd.value = newPwd2.value = "";
};

/* ================= GOOGLE DRIVE SYNC ================= */

const GDRIVE_CLIENT_ID = "628807779499-ql68bc363klkaiuesakd1eknc38qmcah.apps.googleusercontent.com";
const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const VAULT_FILENAME = "securetext.vault";

let gToken = null;

function gAuth() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) reject(resp);
        gToken = resp.access_token;
        console.log("[GDRIVE] Auth OK");
        resolve();
      }
    });
    client.requestAccessToken();
  });
}

async function gFetch(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    Authorization: `Bearer ${gToken}`
  };
  return fetch(url, opts);
}

async function findVaultFile() {
  const q = encodeURIComponent(`name='${VAULT_FILENAME}' and trashed=false`);
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`
  );
  const js = await res.json();
  return js.files?.[0]?.id || null;
}

async function uploadVault(payload) {
  await gAuth();
  const fileId = await findVaultFile();

  const meta = { name: VAULT_FILENAME };
  const boundary = "foo_bar_baz";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(meta) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n` +
    JSON.stringify(payload) + `\r\n` +
    `--${boundary}--`;

  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  const method = fileId ? "PATCH" : "POST";

  const res = await gFetch(url, {
    method,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });

  console.log("[GDRIVE] Upload status:", res.status);
}

async function downloadVault() {
  await gAuth();
  const fileId = await findVaultFile();
  if (!fileId) {
    console.log("[GDRIVE] No vault found");
    return null;
  }
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  const payload = await res.json();
  console.log("[GDRIVE] Downloaded");
  return payload;
}

/* ================= WIRED BUTTONS ================= */

document.getElementById("syncUpBtn").onclick = async () => {
  if (!lastEncrypted) {
    console.log("[GDRIVE] Nothing to upload");
    return;
  }
  await uploadVault(lastEncrypted);
};

document.getElementById("syncDownBtn").onclick = async () => {
  const payload = await downloadVault();
  if (!payload) return;

  // replace local vault with downloaded ciphertext
  lastEncrypted = payload;
  saveEncrypted(lastEncrypted);

  // decrypt into editor (requires unlocked vault)
  if (unlocked) {
    const html = await decryptContent(MASTER_PASSWORD, lastEncrypted);
    editor.innerHTML = html;
  }
};



/* ================= INIT ================= */

(async () => {
  await openDB();
  lastEncrypted = await loadEncrypted();
  editor.innerHTML = "<br>";
})();
