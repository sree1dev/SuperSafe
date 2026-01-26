/*  ui.js  */
"use strict";
/* =========================================================
   UI — FINAL (SAVE FIXED, AUTO OPEN FILE)
========================================================= */

document.addEventListener("DOMContentLoaded", bootUI);

/* ===================== STATE ===================== */

let els = {};
let selectedFolderId = null;
let currentFileId = null;
let dirty = false;

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
    if (drive.isReady()) await renderExplorer();
  });

  focusPassword();
}

/* ===================== CACHE ===================== */

function cacheElements() {
  const ids = [
    "lockScreen","passwordInput","unlockBtn","lockError",
    "app","explorer","tree","editor",
    "adminModal","changePwdModal",
    "adminBtn","logoutBtn","saveBtn",
    "newFolderBtn","newFileBtn","toggleExplorerBtn",
    "connectDriveBtn","openChangePwdBtn",
    "closeAdminBtn","closeChangePwdBtn",
    "oldPwd","newPwd","newPwd2","changePwdConfirmBtn","changeError"
  ];
  ids.forEach(id => els[id] = document.getElementById(id));
}

/* ===================== INITIAL ===================== */

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
      await renderExplorer();
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
    }, 200);
  });
}

/* ===================== EXPLORER ===================== */

function wireExplorer() {
  els.newFolderBtn.onclick = async () => {
    const name = prompt("Folder name");
    if (!name) return;
    await drive.createFolder(name, selectedFolderId || core.driveRoot());
    await renderExplorer();
  };

  els.newFileBtn.onclick = async () => {
    const name = prompt("File name");
    if (!name) return;

    await drive.createFile(name, selectedFolderId || core.driveRoot());
    await renderExplorer();

    const files = await drive.listChildren(selectedFolderId || core.driveRoot());
    const file = files.find(f => f.name === name);
    if (file) openFile(file.id);
  };

  els.toggleExplorerBtn.onclick =
    () => els.explorer.classList.toggle("open");
}

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

async function renderNode(node, container, parentColor) {
  const color = drive.getColor(node.id, parentColor);

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.setProperty("--line-color", color);

  const label = document.createElement("div");
  label.className = "tree-label";
  label.style.color = color;

  /* ===== EMOJI ICON CHANGE (ONLY) ===== */
  const isFolder = drive.isFolder(node);
  label.textContent = (isFolder ? "📁 " : "📝 ") + node.name;
  /* =================================== */

  row.appendChild(label);
  container.appendChild(row);

  if (!isFolder) {
    label.onclick = () => openFile(node.id);
    attachContextMenu(label, node);
    return;
  }

  label.onclick = () => selectedFolderId = node.id;

  const childrenBox = document.createElement("div");
  childrenBox.className = "tree-children";
  container.appendChild(childrenBox);

  const children = await drive.listChildren(node.id);
  for (const child of children) {
    await renderNode(child, childrenBox, color);
  }

  attachContextMenu(label, node);
}

/* ===================== FILE OPEN ===================== */

async function openFile(fileId) {
  if (dirty && !confirm("Unsaved changes. Continue?")) return;

  currentFileId = fileId;
  dirty = false;
  updateSaveState();

  const bytes = await drive.loadFile(fileId);
  const html = await core.decryptForFile(bytes);

  els.editor.innerHTML = html || "";
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
  LOG("UI", "save:click");

  if (!currentFileId) {
    LOG("UI", "save:abort:no-file");
    return;
  }

  if (!dirty) {
    LOG("UI", "save:abort:not-dirty");
    return;
  }

  const html = els.editor.innerHTML;
  LOG("UI", "save:html-bytes", html.length);

  const encrypted = await core.encryptForFile(html);
  LOG("UI", "save:encrypted-bytes", encrypted.length);

  await drive.saveFile(currentFileId, encrypted);
  LOG("UI", "save:done");

  dirty = false;
  updateSaveState();
}

function updateSaveState() {
  els.saveBtn.style.opacity = (!currentFileId || !dirty) ? "0.5" : "1";
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
        els.editor.focus();
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
    if (!action) return;

    if (!core.isAdmin()) return;

    if (action === "delete") {
      const pwd = prompt("Admin password");
      await core.verifyAdmin(pwd);
      await drive.trash(node.id);
      await renderExplorer();
    }

    if (action === "rename") {
      const name = prompt("New name");
      if (!name) return;
      await drive.rename(node.id, name);
      await renderExplorer();
    }
  };
}

/* ===================== ADMIN ===================== */

function wireAdmin() {
  els.connectDriveBtn.onclick = async () => {
    await drive.connect();
    await waitForDrive();
    await renderExplorer();
  };
}
