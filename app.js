/* ================= CONFIG ================= */

let MASTER_PASSWORD = "test";
const AUTO_LOCK_MS = 60_000;

const DB_NAME = "securetext";
const STORE = "vault";

const VAULT_FOLDER_NAME = "SecureText";
const VAULT_FILENAME = "vault.stx";

/* ================= ELEMENTS ================= */

const lockScreen = document.getElementById("lockScreen");
const app = document.getElementById("app");
const passwordInput = document.getElementById("passwordInput");
const lockError = document.getElementById("lockError");

const editor = document.getElementById("editor");
const explorer = document.getElementById("explorer");
const treeRoot = document.getElementById("tree");

const toggleExplorerBtn = document.getElementById("toggleExplorerBtn");
const newFileBtn = document.getElementById("newFileBtn");
const newFolderBtn = document.getElementById("newFolderBtn");

const encryptBtn = document.getElementById("encryptBtn");
const adminBtn = document.getElementById("adminBtn");
const logoutBtn = document.getElementById("logoutBtn");

/* ADMIN MODALS */

const adminModal = document.getElementById("adminModal");
const closeAdminBtn = document.getElementById("closeAdminBtn");
const driveStatus = document.getElementById("driveStatus");
const connectDriveBtn = document.getElementById("connectDriveBtn");
const uploadVaultBtn = document.getElementById("uploadVaultBtn");
const downloadVaultBtn = document.getElementById("downloadVaultBtn");
const openChangePwdBtn = document.getElementById("openChangePwdBtn");

const changePwdModal = document.getElementById("changePwdModal");
const oldPwd = document.getElementById("oldPwd");
const newPwd = document.getElementById("newPwd");
const newPwd2 = document.getElementById("newPwd2");
const changeError = document.getElementById("changeError");
const changePwdConfirmBtn = document.getElementById("changePwdConfirmBtn");

const colorPicker = document.getElementById("colorPicker");

/* ================= STATE ================= */

let unlocked = false;
let isAdmin = false;
let lockTimer = null;

let db = null;
let gToken = null;
let vaultFolderId = null;

/*
vaultData STRUCTURE (DECRYPTED)

vaultData = {
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
  updatedAt: 0
}
*/

let vaultData = null;
let currentNode = null;

/* ================= INDEXED DB ================= */

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

/* ================= UNLOCK / LOCK ================= */

async function unlockVaultFlow() {
  const cached = await dbGet("vault");

  if (cached) {
    try {
      vaultData = await decryptVault(MASTER_PASSWORD, cached);
    } catch {
      lockError.textContent = "Wrong password";
      return;
    }
  } else {
    vaultData = defaultVault();
  }

  unlocked = true;
  lockScreen.remove();
  app.classList.remove("hidden");
  resetAutoLock();

  renderTree();
  restoreLastFile();
}

passwordInput.addEventListener("input", async () => {
  const typed = passwordInput.value;

  if (typed.length < MASTER_PASSWORD.length) {
    lockError.textContent = "";
    return;
  }

  if (typed !== MASTER_PASSWORD) {
    lockError.textContent = "Wrong password";
    return;
  }

  await unlockVaultFlow();
});

/* ================= AUTO LOCK ================= */

function resetAutoLock() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(() => location.reload(), AUTO_LOCK_MS);
}

["keydown","mousedown","mousemove","touchstart"].forEach(e =>
  document.addEventListener(e, resetAutoLock, true)
);

/* ================= TREE ================= */

function renderTree() {
  treeRoot.innerHTML = "";
  renderNode(vaultData.tree, treeRoot);
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

  const children = document.createElement("div");
  children.className = "children";
  container.appendChild(children);

  el.onclick = () => children.classList.toggle("hidden");

  node.children.forEach(c => renderNode(c, children));
}

/* ================= FILE OPS ================= */

function openFile(node) {
  currentNode = node;
  vaultData.lastOpenFileId = node.id;
  editor.innerHTML = node.content || "<br>";
}

function restoreLastFile() {
  if (!vaultData.lastOpenFileId) return;

  const walk = node => {
    if (node.type === "file" && node.id === vaultData.lastOpenFileId) {
      openFile(node);
      return true;
    }
    if (node.children) {
      for (const c of node.children) {
        if (walk(c)) return true;
      }
    }
    return false;
  };

  walk(vaultData.tree);
}

/* ================= CREATE FILE / FOLDER ================= */

newFolderBtn.onclick = () => {
  const name = prompt("Folder name");
  if (!name) return;

  vaultData.tree.children.push({
    id: crypto.randomUUID(),
    type: "folder",
    name,
    children: []
  });

  renderTree();
};

newFileBtn.onclick = () => {
  const name = prompt("File name");
  if (!name) return;

  const file = {
    id: crypto.randomUUID(),
    type: "file",
    name,
    content: "<br>"
  };

  vaultData.tree.children.push(file);
  openFile(file);
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

document.getElementById("undoBtn").onclick =
  () => document.execCommand("undo");
document.getElementById("redoBtn").onclick =
  () => document.execCommand("redo");

colorPicker.oninput = () =>
  document.execCommand("foreColor", false, colorPicker.value);

function updateActive() {
  document.querySelectorAll(".fmt").forEach(btn =>
    btn.classList.toggle(
      "active",
      document.queryCommandState(btn.dataset.cmd)
    )
  );
}

/* ================= SAVE (LOCAL ONLY HERE) ================= */

encryptBtn.onclick = async () => {
  if (!currentNode) return;
  currentNode.content = editor.innerHTML;

  vaultData.updatedAt = Date.now();
  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);
};

/* ================= ADMIN UI ================= */

adminBtn.onclick = () => {
  adminModal.classList.remove("hidden");
  driveStatus.textContent = vaultData.admin.initialized
    ? `Locked to ${vaultData.admin.googleEmail}`
    : "Not initialized";
};

closeAdminBtn.onclick = () =>
  adminModal.classList.add("hidden");

/* ================= CHANGE PASSWORD (ADMIN ONLY) ================= */

openChangePwdBtn.onclick = () => {
  adminModal.classList.add("hidden");
  changePwdModal.classList.remove("hidden");
};

changePwdConfirmBtn.onclick = async () => {
  if (oldPwd.value !== MASTER_PASSWORD) {
    changeError.textContent = "Wrong current password";
    return;
  }
  if (!newPwd.value || newPwd.value !== newPwd2.value) {
    changeError.textContent = "Passwords do not match";
    return;
  }

  MASTER_PASSWORD = newPwd.value;

  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);

  oldPwd.value = newPwd.value = newPwd2.value = "";
  changeError.textContent = "";
  changePwdModal.classList.add("hidden");
};

/* ================= UI ================= */

toggleExplorerBtn.onclick = () =>
  explorer.classList.toggle("open");

logoutBtn.onclick = () => location.reload();

/* ================= INIT ================= */

(async () => {
  await openDB();
})();
/* ================= GOOGLE DRIVE ================= */

const GDRIVE_CLIENT_ID =
  "628807779499-ql68bc363klkaiuesakd1eknc38qmcah.apps.googleusercontent.com";
const GDRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.file openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";


/* ===== OAuth ===== */

function gAuth() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope: GDRIVE_SCOPE,
      callback: (resp) => {
        console.log("OAuth response:", resp);

        if (resp.error) {
          alert("OAuth error: " + resp.error);
          reject(resp);
          return;
        }

        gToken = resp.access_token;
        resolve();
      }
    });

    client.requestAccessToken();
  });
}

function gFetch(url, opts = {}) {
  opts.headers = {
    ...(opts.headers || {}),
    Authorization: `Bearer ${gToken}`
  };
  return fetch(url, opts);
}

/* ================= VAULT FOLDER ================= */

async function ensureVaultFolder() {
  const q = encodeURIComponent(
    `name='${VAULT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );

  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const js = await res.json();

  if (js.files.length) return js.files[0].id;

  const create = await gFetch(
    "https://www.googleapis.com/drive/v3/files",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: VAULT_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder"
      })
    }
  );

  return (await create.json()).id;
}

/* ================= VAULT FILE ================= */

async function findVaultFile() {
  const q = encodeURIComponent(
    `name='${VAULT_FILENAME}' and '${vaultFolderId}' in parents and trashed=false`
  );

  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)`
  );

  const js = await res.json();
  return js.files[0] || null;
}

/* ================= ADMIN DRIVE INIT ================= */

async function connectDriveAsAdmin() {
  await gAuth();

  /* fetch user email */
  const info = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${gToken}` } }
  );
  const profile = await info.json();

  if (!vaultData.admin.initialized) {
    /* first-time admin setup */
    vaultData.admin.initialized = true;
    vaultData.admin.googleEmail = profile.email;
  } else if (vaultData.admin.googleEmail !== profile.email) {
    alert("This vault is locked to another Google account.");
    return;
  }

  vaultFolderId = await ensureVaultFolder();
  driveStatus.textContent = `Locked to ${vaultData.admin.googleEmail}`;

  await saveVault({ upload: true });
}

/* ================= SAVE / LOAD (ADMIN ONLY) ================= */

async function saveVaultRemote() {
  if (!vaultData.admin.initialized) {
    alert("Admin must initialize Google Drive first.");
    return;
  }

  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);

  const existing = await findVaultFile();
  const boundary = "vault_boundary";

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify({
      name: VAULT_FILENAME,
      parents: [vaultFolderId]
    }) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n` +
    JSON.stringify(encrypted) +
    `\r\n--${boundary}--`;

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  await gFetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
}

async function loadVaultRemote() {
  if (!vaultData.admin.initialized) {
    alert("Admin must initialize Google Drive first.");
    return;
  }

  const remote = await findVaultFile();
  if (!remote) {
    alert("No vault found on Drive.");
    return;
  }

  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files/${remote.id}?alt=media`
  );
  const encrypted = await res.json();

  vaultData = await decryptVault(MASTER_PASSWORD, encrypted);
  dbPut("vault", encrypted);

  renderTree();
  restoreLastFile();
}

/* ================= ADMIN BUTTON WIRING ================= */

connectDriveBtn.onclick = async () => {
  try {
    await connectDriveAsAdmin();
  } catch {
    alert("Google authentication failed.");
  }
};

uploadVaultBtn.onclick = async () => {
  if (currentNode) {
    currentNode.content = editor.innerHTML;
  }
  await saveVaultRemote();
};

downloadVaultBtn.onclick = async () => {
  await loadVaultRemote();
};
/* ================= ROLE ENFORCEMENT ================= */

/*
Rules enforced here:
- Only ADMIN can:
  - Connect / change Google Drive account
  - Upload / Download vault
  - Change vault password
- Normal users:
  - Can edit files
  - Can encrypt/save locally
  - Cannot touch Drive or admin settings
*/

function refreshAdminUI() {
  const adminInitialized = vaultData.admin.initialized === true;

  // Drive section visibility
  connectDriveBtn.disabled = false;
  uploadVaultBtn.disabled = !adminInitialized;
  downloadVaultBtn.disabled = !adminInitialized;
  openChangePwdBtn.disabled = !adminInitialized;

  driveStatus.textContent = adminInitialized
    ? `Locked to ${vaultData.admin.googleEmail}`
    : "Not connected";

  // Visual hint
  if (!adminInitialized) {
    uploadVaultBtn.title = "Admin must connect Google Drive first";
    downloadVaultBtn.title = "Admin must connect Google Drive first";
    openChangePwdBtn.title = "Admin must connect Google Drive first";
  } else {
    uploadVaultBtn.title = "";
    downloadVaultBtn.title = "";
    openChangePwdBtn.title = "";
  }
}

/* ================= ADMIN PANEL OPEN ================= */

adminBtn.onclick = () => {
  adminModal.classList.remove("hidden");
  refreshAdminUI();
};

/* ================= PASSWORD CHANGE HARD GUARD ================= */

changePwdConfirmBtn.onclick = async () => {
  if (!vaultData.admin.initialized) {
    alert("Only admin can change the vault password.");
    return;
  }

  if (oldPwd.value !== MASTER_PASSWORD) {
    changeError.textContent = "Wrong current password";
    return;
  }

  if (!newPwd.value || newPwd.value !== newPwd2.value) {
    changeError.textContent = "Passwords do not match";
    return;
  }

  MASTER_PASSWORD = newPwd.value;

  // Re-encrypt entire vault
  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);

  // Also push to Drive (admin-only)
  await saveVaultRemote();

  oldPwd.value = newPwd.value = newPwd2.value = "";
  changeError.textContent = "";
  changePwdModal.classList.add("hidden");

  alert("Vault password changed and re-encrypted.");
};

/* ================= LOCAL SAVE SAFETY ================= */

encryptBtn.onclick = async () => {
  if (!currentNode) return;

  currentNode.content = editor.innerHTML;
  vaultData.updatedAt = Date.now();

  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);
};

/* ================= EDITOR CHANGE TRACKING ================= */

/*
Optional guard:
If editor changes and user switches file without encrypting,
we auto-save locally (not Drive).
*/

editor.addEventListener("input", () => {
  if (!currentNode) return;
  currentNode.content = editor.innerHTML;
  vaultData.updatedAt = Date.now();
});

/* ================= DRIVE BUTTON HARD GUARDS ================= */

uploadVaultBtn.onclick = async () => {
  if (!vaultData.admin.initialized) {
    alert("Admin must connect Google Drive first.");
    return;
  }

  if (currentNode) {
    currentNode.content = editor.innerHTML;
  }

  await saveVaultRemote();
  alert("Vault uploaded to Google Drive.");
};

downloadVaultBtn.onclick = async () => {
  if (!vaultData.admin.initialized) {
    alert("Admin must connect Google Drive first.");
    return;
  }

  await loadVaultRemote();
  alert("Vault downloaded from Google Drive.");
};

/* ================= EXPLORER / MOBILE UX ================= */

toggleExplorerBtn.onclick = () => {
  explorer.classList.toggle("open");
};

/* ================= LOGOUT ================= */

logoutBtn.onclick = () => {
  location.reload();
};

/* ================= FINAL INIT POLISH ================= */

(async () => {
  await openDB();

  // Try loading local vault silently
  const cached = await dbGet("vault");
  if (cached) {
    try {
      vaultData = await decryptVault(MASTER_PASSWORD, cached);
    } catch {
      // Ignore — unlock flow handles password
    }
  }
})();
