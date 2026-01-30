/* ui.js */
"use strict";
/* =========================================================
   UI — LOCAL-FIRST · MANUAL SYNC · CACHE-DRIVEN (FINAL)
========================================================= */

document.addEventListener("DOMContentLoaded", bootUI);

/* ===================== STATE ===================== */

let els = {};
let currentFileId = null;
let selectedFolderId = null;
let selectedLabelEl = null;

let dirty = false;
let isSaving = false;
let autosaveTimer = null;
let lastTreeSignature = null;

/* ===================== BOOT ===================== */

function bootUI() {
  cacheElements();
  resetInitialState();
  wireLock();
  wireExplorer();
  wireToolbar();
  wireAdmin();
  wireEditor();
  focusPassword();
}

/* ===================== ELEMENT CACHE ===================== */

function cacheElements() {
  [
    "lockScreen","passwordInput","unlockBtn","lockError",
    "app","explorer","tree","editor",
    "adminModal",
    "adminBtn","logoutBtn","saveBtn","refreshBtn",
    "newFolderBtn","newFileBtn","toggleExplorerBtn",
    "connectDriveBtn","closeAdminBtn"
  ].forEach(id => {
    els[id] = document.getElementById(id);
    if (!els[id]) console.warn("UI missing:", id);
  });
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
  els.passwordInput.value = "";
  els.passwordInput.focus();
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
      await manualRefresh();
    } catch {
      els.lockError.textContent = "Wrong password";
    }
  };
}

function waitForDrive() {
  return new Promise(resolve => {
    const t = setInterval(() => {
      if (drive.isReady()) {
        clearInterval(t);
        resolve();
      }
    }, 120);
  });
}

/* ===================== EXPLORER ===================== */

function wireExplorer() {
  els.newFolderBtn.onclick = async () => {
    const name = prompt("Folder name");
    if (!name) return;

    await drive.createFolder(name, selectedFolderId || core.driveRoot());
    await manualRefresh();
  };

  els.newFileBtn.onclick = async () => {
    const name = prompt("File name");
    if (!name) return;

    await drive.createFile(name, selectedFolderId || core.driveRoot());
    await manualRefresh();

    const files = await drive.listChildren(selectedFolderId || core.driveRoot());
    const f = files.find(x => x.name === name);
    if (f) await openFile(f.id);
  };

  els.toggleExplorerBtn.onclick =
    () => els.explorer.classList.toggle("open");
}

/* ===================== MANUAL REFRESH ===================== */

async function manualRefresh() {
  await cache.flushAll();

  const sig = await buildTreeSignature(core.driveRoot());
  if (sig === lastTreeSignature) return;

  lastTreeSignature = sig;
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

/* ===================== TREE ===================== */

async function renderExplorer() {
  els.tree.innerHTML = "";
  selectedFolderId = null;
  selectedLabelEl = null;

  const root = {
    id: core.driveRoot(),
    name: "SecureText",
    mimeType: "application/vnd.google-apps.folder"
  };

  await renderNode(root, els.tree, null);
}

function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h << 5) - h + id.charCodeAt(i);
    h |= 0;
  }
  return `hsl(${Math.abs(h) % 360},70%,60%)`;
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

  label.onclick = async () => {
    setSelected(label);
    if (isFolder) {
      selectedFolderId = node.id;
    } else {
      await openFile(node.id);
    }
  };

  if (isFolder) {
    label.ondblclick = () =>
      childrenBox.classList.toggle("hidden");
  }

  attachContextMenu(label, node);

  if (!isFolder) return;

  const children = await drive.listChildren(node.id);
  for (const child of children) {
    await renderNode(child, childrenBox, color);
  }
}

/* ===================== SELECTION ===================== */

function setSelected(el) {
  if (selectedLabelEl) selectedLabelEl.classList.remove("selected");
  selectedLabelEl = el;
  el.classList.add("selected");
}

/* ===================== FILE OPEN ===================== */

async function openFile(fileId) {
  if (dirty && currentFileId) {
    await cache.saveLocal(currentFileId, els.editor.innerHTML);
  }

  currentFileId = fileId;
  dirty = false;
  updateSaveState();

  els.editor.innerHTML = "";

  const text = await cache.loadText(fileId);
  if (currentFileId === fileId) {
    els.editor.innerHTML = text || "";
  }
}

/* ===================== EDITOR ===================== */

function wireEditor() {
  els.editor.oninput = () => {
    dirty = true;
    updateSaveState();

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      if (currentFileId) {
        cache.saveLocal(currentFileId, els.editor.innerHTML);
      }
    }, 800);
  };
}

/* ===================== SAVE ===================== */

async function saveCurrentFile() {
  if (!currentFileId || !dirty || isSaving) return;

  isSaving = true;
  els.saveBtn.textContent = "Saving…";

  await cache.saveLocal(currentFileId, els.editor.innerHTML);
  await cache.flushAll();

  dirty = false;
  isSaving = false;
  els.saveBtn.textContent = "Encrypt & Save";
  updateSaveState();
}

function updateSaveState() {
  els.saveBtn.style.opacity =
    (!currentFileId || !dirty || isSaving) ? "0.45" : "1";
}

/* ===================== TOOLBAR ===================== */

function wireToolbar() {
  els.saveBtn.onclick = saveCurrentFile;
  els.refreshBtn.onclick = manualRefresh;

  els.logoutBtn.onclick = async () => {
    if (isSaving) return;

    isSaving = true;
    els.logoutBtn.textContent = "Saving…";

    if (dirty && currentFileId) {
      await cache.saveLocal(currentFileId, els.editor.innerHTML);
    }

    await cache.flushAll();
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
    if (!core.isAdmin()) return;

    const action = prompt("rename / delete ?");
    if (!action) return;

    if (action === "delete") {
      const pwd = prompt("Admin password");
      await core.verifyAdmin(pwd);
      cache.invalidate(node.id);
      await drive.trash(node.id);
      await manualRefresh();
    }

    if (action === "rename") {
      const name = prompt("New name");
      if (!name) return;
      await drive.rename(node.id, name);
      await manualRefresh();
    }
  };
}

/* ===================== ADMIN ===================== */

function wireAdmin() {
  els.connectDriveBtn.onclick = async () => {
    await drive.connect();
    await waitForDrive();
    await manualRefresh();
  };
}
