/* ================= CONFIG ================= */

let MASTER_PASSWORD = "test";
const AUTO_LOCK_MS = 60000;

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

const explorer = document.getElementById("explorer");
const treeRoot = document.getElementById("tree");

const newFileBtn = document.getElementById("newFileBtn");
const newFolderBtn = document.getElementById("newFolderBtn");
const toggleExplorerBtn = document.getElementById("toggleExplorerBtn");

/* ================= STATE ================= */

let unlocked = false;
let lockTimer = null;

let db = null;
let indexData = null;
let currentNode = null;

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

function dbGet(key) {
  return new Promise(resolve => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
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
    { name: "PBKDF2", salt: enc.encode("securetext"), iterations: 150000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptObj(password, obj) {
  const key = await deriveKey(password);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(obj))
  );
  return { iv: [...iv], data: [...new Uint8Array(cipher)] };
}

async function decryptObj(password, payload) {
  const key = await deriveKey(password);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data)
  );
  return JSON.parse(dec.decode(plain));
}

/* ================= INDEX / TREE ================= */

function defaultIndex() {
  return { tree: { type: "folder", name: "Root", children: [] } };
}

function renderTree() {
  treeRoot.innerHTML = "";
  renderNode(indexData.tree, treeRoot);
}

function renderNode(node, parent) {
  const el = document.createElement("div");
  el.className = "node";
  el.textContent = node.name;
  parent.appendChild(el);

  if (node.type === "file") {
    el.onclick = () => {
      currentNode = node;
      editor.innerHTML = node.content || "<br>";
    };
    return;
  }

  const children = document.createElement("div");
  children.className = "children";
  parent.appendChild(children);

  el.onclick = () => children.classList.toggle("hidden");
  node.children.forEach(c => renderNode(c, children));
}

/* ================= FILE / FOLDER ================= */

newFolderBtn.onclick = () => {
  const name = prompt("Folder name");
  if (!name) return;
  indexData.tree.children.push({ type: "folder", name, children: [] });
  renderTree();
};

newFileBtn.onclick = () => {
  const name = prompt("File name");
  if (!name) return;
  indexData.tree.children.push({ type: "file", name, content: "<br>" });
  renderTree();
};

/* ================= TOOLBAR ================= */

document.querySelectorAll("[data-cmd]").forEach(btn => {
  btn.onclick = () => {
    document.execCommand(btn.dataset.cmd);
    updateActive();
  };
});

document.getElementById("bulletBtn").onclick = () => {
  document.execCommand("insertUnorderedList");
  updateActive();
};

document.getElementById("numberBtn").onclick = () => {
  document.execCommand("insertOrderedList");
  updateActive();
};

document.getElementById("undoBtn").onclick = () => document.execCommand("undo");
document.getElementById("redoBtn").onclick = () => document.execCommand("redo");

colorPicker.oninput = () =>
  document.execCommand("foreColor", false, colorPicker.value);

function updateActive() {
  document.querySelectorAll(".fmt").forEach(b =>
    b.classList.toggle("active", document.queryCommandState(b.dataset.cmd))
  );
}

/* ================= SAVE / ENCRYPT ================= */

document.getElementById("encryptBtn").onclick = async () => {
  if (!currentNode) return;
  currentNode.content = editor.innerHTML;
  const encrypted = await encryptObj(MASTER_PASSWORD, indexData);
  dbPut("vault", encrypted);
};

/* ================= UNLOCK ================= */

function unlockVault() {
  unlocked = true;
  lockScreen.remove();
  app.classList.remove("hidden");
  resetAutoLock();
}

passwordInput.oninput = () => {
  if (passwordInput.value === MASTER_PASSWORD) unlockVault();
  else lockError.textContent = "Wrong password";
};

/* ================= AUTO LOCK ================= */

function resetAutoLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => location.reload(), AUTO_LOCK_MS);
}

["keydown","mousedown","mousemove","touchstart"].forEach(e =>
  document.addEventListener(e, resetAutoLock, true)
);

/* ================= UI ================= */

toggleExplorerBtn.onclick = () =>
  explorer.classList.toggle("open");

document.getElementById("logoutBtn").onclick = () =>
  location.reload();

/* ================= INIT ================= */

(async () => {
  await openDB();
  const saved = await dbGet("vault");
  if (saved) indexData = await decryptObj(MASTER_PASSWORD, saved);
  else indexData = defaultIndex();
  renderTree();
})();
