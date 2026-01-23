/* ================= CONFIG ================= */

let MASTER_PASSWORD = "test";
const AUTO_LOCK_MS = 60_000;

const DB_NAME = "securetext";
const STORE = "vault";

const VAULT_FOLDER_NAME = "SecureText";
const INDEX_FILENAME = ".index.stx";

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

const explorer = document.getElementById("explorer");
const treeRoot = document.getElementById("tree");

/* ================= STATE ================= */

let unlocked = false;
let db = null;
let lockTimer = null;

let vaultFolderId = null;
let indexData = null;

let currentFileNode = null;
let currentRemoteMeta = null;

/* ================= DB ================= */

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

function dbPut(key, val) {
  db.transaction(STORE, "readwrite").objectStore(STORE).put(val, key);
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

async function encrypt(password, obj) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { iv: [...iv], data: [...new Uint8Array(cipher)] };
}

async function decrypt(password, payload) {
  const key = await deriveKey(password);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data)
  );
  return JSON.parse(dec.decode(plain));
}

/* ================= GOOGLE DRIVE ================= */

const CLIENT_ID =
  "628807779499-ql68bc363klkaiuesakd1eknc38qmcah.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
let gToken = null;

function gAuth() {
  return new Promise((resolve, reject) => {
    google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: r => {
        if (r.error) reject(r);
        gToken = r.access_token;
        resolve();
      }
    }).requestAccessToken();
  });
}

function gFetch(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    Authorization: `Bearer ${gToken}`
  };
  return fetch(url, opts);
}

/* ================= VAULT ================= */

async function ensureVaultFolder() {
  const q = encodeURIComponent(
    `name='${VAULT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const js = await res.json();
  if (js.files.length) return js.files[0].id;

  const create = await gFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: VAULT_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder"
    })
  });
  return (await create.json()).id;
}

/* ================= INDEX ================= */

function defaultIndex() {
  return {
    tree: {
      id: "root",
      type: "folder",
      name: "Root",
      children: []
    }
  };
}

async function loadIndex() {
  const q = encodeURIComponent(
    `name='${INDEX_FILENAME}' and '${vaultFolderId}' in parents and trashed=false`
  );
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const js = await res.json();

  if (!js.files.length) {
    indexData = defaultIndex();
    await saveIndex();
    return;
  }

  const payload = await downloadFile(js.files[0].id);
  indexData = await decrypt(MASTER_PASSWORD, payload);
}

async function saveIndex() {
  const payload = await encrypt(MASTER_PASSWORD, indexData);
  await uploadFile(INDEX_FILENAME, payload);
}

/* ================= TREE ================= */

function renderTree() {
  treeRoot.innerHTML = "";
  renderNode(indexData.tree, treeRoot);
}

function renderNode(node, container) {
  const div = document.createElement("div");
  div.className = "node " + node.type;
  div.textContent = node.name;
  container.appendChild(div);

  if (node.type === "file") {
    div.onclick = () => openFile(node);
  } else {
    const kids = document.createElement("div");
    kids.className = "children";
    div.onclick = () => kids.classList.toggle("hidden");
    container.appendChild(kids);
    node.children.forEach(c => renderNode(c, kids));
  }
}

/* ================= FILE OPS ================= */

async function openFile(node) {
  const meta = await findFile(node.id);
  const payload = await downloadFile(meta.id);
  const data = await decrypt(MASTER_PASSWORD, payload);

  currentFileNode = node;
  currentRemoteMeta = meta;
  editor.innerHTML = data.html;
}

async function saveCurrentFile() {
  if (!currentFileNode) return;

  const payload = await encrypt(MASTER_PASSWORD, {
    html: editor.innerHTML
  });

  await uploadFile(currentFileNode.id, payload);
  await saveIndex();
}

/* ================= DRIVE FILE ================= */

async function findFile(name) {
  const q = encodeURIComponent(
    `name='${name}' and '${vaultFolderId}' in parents and trashed=false`
  );
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)`
  );
  return (await res.json()).files[0];
}

async function uploadFile(name, payload) {
  const existing = await findFile(name);
  const boundary = "x";
  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify({ name, parents: [vaultFolderId] }) +
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n` +
    JSON.stringify(payload) +
    `\r\n--${boundary}--`;

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  await gFetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
}

async function downloadFile(id) {
  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
  );
  return res.json();
}

/* ================= UNLOCK ================= */

function unlockVault() {
  unlocked = true;
  lockScreen.remove();
  app.classList.remove("hidden");
  resetAutoLock();
}

passwordInput.oninput = e => {
  if (e.target.value === MASTER_PASSWORD) unlockVault();
  else lockError.textContent = "Wrong password";
};

/* ================= AUTO LOCK ================= */

function resetAutoLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => location.reload(), AUTO_LOCK_MS);
}

["keydown", "mousedown", "mousemove", "touchstart"].forEach(e =>
  document.addEventListener(e, resetAutoLock, true)
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
};

/* ================= BUTTONS ================= */

document.getElementById("encryptBtn").onclick = saveCurrentFile;

/* ================= INIT ================= */

(async () => {
  await openDB();
  await gAuth();
  vaultFolderId = await ensureVaultFolder();
  await loadIndex();
  renderTree();
})();
