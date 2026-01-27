/* ui.js */
"use strict";
/* =========================================================
   UI — OPTION A + SELECTION + DBLCLICK COLLAPSE (OPTIMIZED)
========================================================= */

document.addEventListener("DOMContentLoaded", bootUI);

/* ===================== STATE ===================== */

let els = {};
let selectedFolderId = null;
let currentFileId = null;
let dirty = false;

let lastTreeSignature = null;
let selectedLabelEl = null;

/* ===================== BOOT ===================== */

function bootUI() {
  cacheElements();
  resetInitialState();
  wireLock();
  wireExplorer();
  wireToolbar();
  wireAdmin();
  wireEditor();

  document.addEventListener("drive-refresh", async () => {
    if (!drive.isReady()) return;
    await conditionalRefresh(false);
  });

  focusPassword();
}

/* ===================== CACHE ===================== */

function cacheElements() {
  [
    "lockScreen","passwordInput","unlockBtn","lockError",
    "app","explorer","tree","editor",
    "adminModal","changePwdModal",
    "adminBtn","logoutBtn","saveBtn",
    "newFolderBtn","newFileBtn","toggleExplorerBtn",
    "connectDriveBtn","openChangePwdBtn",
    "closeAdminBtn","closeChangePwdBtn"
  ].forEach(id => els[id] = document.getElementById(id));
}

/* ===================== INIT ===================== */

function resetInitialState() {
  els.lockScreen.classList.remove("hidden");
  els.app.classList.add("hidden");
  els.editor.innerHTML = "";
  currentFileId = null;
  dirty = false;
  updateSaveState();
}

function focusPassword() {
  els.passwordInput.focus();
  els.passwordInput.value = "";
}

/* ===================== LOCK ===================== */

function wireLock() {
  els.unlockBtn.onclick = async () => {
    const pwd = els.passwordInput.value.trim();
    if (!pwd) return;

    try {
      await core.unlockVault(pwd);
      els.lockScreen.classList.add("hidden");
      els.app.classList.remove("hidden");

      await drive.trySilentConnect();
      await waitForDrive();

      lastTreeSignature = null;
      await conditionalRefresh(true);
    } catch {
      els.lockError.textContent = "Wrong password";
    }
  };
}

function waitForDrive() {
  return new Promise(r => {
    const t = setInterval(() => {
      if (drive.isReady()) {
        clearInterval(t);
        r();
      }
    }, 150);
  });
}

/* ===================== EXPLORER ===================== */

function wireExplorer() {
  els.newFolderBtn.onclick = async () => {
    const name = prompt("Folder name");
    if (!name) return;

    await drive.createFolder(name, selectedFolderId || core.driveRoot());
    await conditionalRefresh(true);
  };

  els.newFileBtn.onclick = async () => {
    const name = prompt("File name");
    if (!name) return;

    await drive.createFile(name, selectedFolderId || core.driveRoot());
    await conditionalRefresh(true);

    const files = await drive.listChildren(selectedFolderId || core.driveRoot());
    const f = files.find(x => x.name === name);
    if (f) openFile(f.id, true);
  };

  els.toggleExplorerBtn.onclick =
    () => els.explorer.classList.toggle("open");
}

/* ===================== CONDITIONAL REFRESH ===================== */

async function conditionalRefresh(force) {
  const signature = await buildTreeSignature(core.driveRoot());
  if (!force && signature === lastTreeSignature) return;

  lastTreeSignature = signature;
  await renderExplorer();
}

async function buildTreeSignature(folderId, acc = []) {
  const children = await drive.listChildren(folderId);
  for (const c of children) {
    acc.push(`${c.id}|${c.name}|${c.mimeType}|${folderId}`);
    if (drive.isFolder(c)) {
      await buildTreeSignature(c.id, acc);
    }
  }
  return acc.sort().join(";");
}

/* ===================== COLOR ===================== */

function colorFromId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 70%, 60%)`;
}

/* ===================== TREE RENDER ===================== */

async function renderExplorer() {
  els.tree.innerHTML = "";
  selectedFolderId = null;

  const root = {
    id: core.driveRoot(),
    name: "SecureText",
    mimeType: "application/vnd.google-apps.folder"
  };

  await renderNode(root, els.tree, null);
}

async function renderNode(node, container, inheritedColor) {
  const isFolder = drive.isFolder(node);
  const color = inheritedColor || colorFromId(node.id);

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.setProperty("--line-color", color);

  const label = document.createElement("div");
  label.className = "tree-label";
  label.style.color = color;
  label.textContent = (isFolder ? "📁 " : "📝 ") + node.name;

  row.appendChild(label);
  container.appendChild(row);

  let childrenBox = null;

  if (isFolder) {
    childrenBox = document.createElement("div");
    childrenBox.className = "tree-children";
    container.appendChild(childrenBox);
  }

  /* SINGLE CLICK */
  label.onclick = () => {
    setSelected(label);
    if (isFolder) {
      selectedFolderId = node.id;
    } else {
      openFile(node.id);
    }
  };

  /* DOUBLE CLICK */
  if (isFolder) {
    label.ondblclick = () => {
      childrenBox.classList.toggle("hidden");
    };
  }

  attachContextMenu(label, node);

  if (!isFolder) return;

  const children = await drive.listChildren(node.id);
  for (const child of children) {
    await renderNode(child, childrenBox, color);
  }
}

/* ===================== SELECTION ===================== */

function setSelected(labelEl) {
  if (selectedLabelEl) {
    selectedLabelEl.classList.remove("selected");
  }
  selectedLabelEl = labelEl;
  selectedLabelEl.classList.add("selected");
}

/* ===================== FILE OPEN (INSTANT) ===================== */

async function openFile(fileId, skipConfirm = false) {
  if (dirty && !skipConfirm) {
    const ok = confirm("Unsaved changes. Continue?");
    if (!ok) return;
  }

  currentFileId = fileId;
  dirty = false;
  updateSaveState();

  // cache-first → instant
  const bytes = await drive.loadFile(fileId);
  els.editor.innerHTML = "";

  // decrypt async but no UI delay
  queueMicrotask(async () => {
    const html = await core.decryptForFile(bytes);
    if (currentFileId === fileId) {
      els.editor.innerHTML = html || "";
    }
  });
}

/* ===================== EDITOR ===================== */

function wireEditor() {
  els.editor.oninput = () => {
    dirty = true;
    updateSaveState();
  };
}

/* ===================== SAVE ===================== */

async function saveCurrentFile() {
  if (!currentFileId || !dirty) return;

  const encrypted = await core.encryptForFile(els.editor.innerHTML);
  await drive.saveFile(currentFileId, encrypted);

  dirty = false;
  updateSaveState();
}

function updateSaveState() {
  els.saveBtn.style.opacity =
    (!currentFileId || !dirty) ? "0.45" : "1";
}

/* ===================== TOOLBAR ===================== */

function wireToolbar() {
  els.saveBtn.onclick = saveCurrentFile;

  els.logoutBtn.onclick = async () => {
    if (dirty) await saveCurrentFile();
    location.reload();
  };

  els.adminBtn.onclick =
    () => els.adminModal.classList.remove("hidden");

  els.closeAdminBtn.onclick =
    () => els.adminModal.classList.add("hidden");

  document.querySelectorAll("#toolbar button[data-cmd]")
    .forEach(btn => {
      btn.onclick = () => {
        document.execCommand(btn.dataset.cmd, false, null);
        dirty = true;
        updateSaveState();
      };
    });
}

/* ===================== CONTEXT MENU ===================== */

function attachContextMenu(el, node) {
  el.oncontextmenu = async e => {
    e.preventDefault();
    const action = prompt("rename / delete ?");
    if (!action || !core.isAdmin()) return;

    if (action === "delete") {
      const pwd = prompt("Admin password");
      await core.verifyAdmin(pwd);
      await drive.trash(node.id);
      await conditionalRefresh(true);
    }

    if (action === "rename") {
      const name = prompt("New name");
      if (!name) return;
      await drive.rename(node.id, name);
      await conditionalRefresh(true);
    }
  };
}

/* ===================== ADMIN ===================== */

function wireAdmin() {
  els.connectDriveBtn.onclick = async () => {
    await drive.connect();
    await waitForDrive();
    lastTreeSignature = null;
    await conditionalRefresh(true);
  };
}
