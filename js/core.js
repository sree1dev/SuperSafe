"use strict";
/* ================= GLOBAL CONFIG ================= */

const AUTO_LOCK_MS = 60_000;
const DB_NAME = "securetext";
const STORE = "vault";

let MASTER_PASSWORD = "test";

/* ================= GLOBAL STATE ================= */

let vaultData = null;
let unlocked = false;
let lockTimer = null;
let db = null;
let currentNode = null;

let gToken = null;
let vaultFolderId = null;

/* ================= INDEXED DB ================= */

async function openDB() {
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
  db.transaction(STORE, "readwrite")
    .objectStore(STORE)
    .put(val, key);
}

function dbGet(key) {
  return new Promise(resolve => {
    const req = db.transaction(STORE)
      .objectStore(STORE)
      .get(key);
    req.onsuccess = () => resolve(req.result || null);
  });
}

/* ================= DEFAULT VAULT ================= */

function defaultVault() {
  return {
    admin: {
      initialized: false,
      googleEmail: null
    },
    tree: {
      id: "root",
      type: "folder",
      name: "Root",
      children: []
    },
    lastOpenFileId: null,
    updatedAt: Date.now()
  };
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

async function encryptVault(password, obj) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(obj));

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  return {
    iv: [...iv],
    data: [...new Uint8Array(cipher)]
  };
}

async function decryptVault(password, payload) {
  const key = await deriveKey(password);

  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data)
  );

  return JSON.parse(dec.decode(plain));
}

/* ================= LOCK / UNLOCK ================= */

async function unlockVaultFlow(password) {
  const cached = await dbGet("vault");

  if (cached) {
    vaultData = await decryptVault(password, cached);
  } else {
    vaultData = defaultVault();
  }

  unlocked = true;
  resetAutoLock();
  renderTree();
  restoreLastFile();
}

/* ================= AUTO LOCK ================= */

function resetAutoLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => location.reload(), AUTO_LOCK_MS);
}

["keydown","mousedown","mousemove","touchstart"].forEach(evt =>
  document.addEventListener(evt, resetAutoLock, true)
);

/* ================= TREE ================= */

function renderTree() {
  const tree = document.getElementById("tree");
  if (!tree) return;

  tree.innerHTML = "";
  renderNode(vaultData.tree, tree);
}

function renderNode(node, container) {
  const el = document.createElement("div");
  el.className = "node " + node.type;
  el.textContent = node.name;
  container.appendChild(el);

  if (node.type === "file") {
    el.onclick = () => openFile(node);
    return;
  }

  const kids = document.createElement("div");
  kids.className = "children";
  container.appendChild(kids);

  el.onclick = () => kids.classList.toggle("hidden");
  node.children.forEach(c => renderNode(c, kids));
}

/* ================= FILE OPS ================= */

function openFile(node) {
  currentNode = node;
  vaultData.lastOpenFileId = node.id;

  const editor = document.getElementById("editor");
  if (editor) editor.innerHTML = node.content || "<br>";
}

function restoreLastFile() {
  if (!vaultData.lastOpenFileId) return;

  (function walk(n) {
    if (n.type === "file" && n.id === vaultData.lastOpenFileId) {
      openFile(n);
      return true;
    }
    return n.children?.some(walk);
  })(vaultData.tree);
}

/* ================= CREATE ================= */

function createFolder(name, parent = vaultData.tree) {
  parent.children.push({
    id: crypto.randomUUID(),
    type: "folder",
    name,
    children: []
  });
  renderTree();
}

function createFile(name, parent = vaultData.tree) {
  const file = {
    id: crypto.randomUUID(),
    type: "file",
    name,
    content: "<br>"
  };
  parent.children.push(file);
  openFile(file);
  renderTree();
}

/* ================= LOCAL SAVE ================= */

async function saveLocal() {
  if (currentNode) {
    const editor = document.getElementById("editor");
    currentNode.content = editor.innerHTML;
  }

  vaultData.updatedAt = Date.now();
  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);
}

/* ================= INIT ================= */

(async () => {
  await openDB();
})();
