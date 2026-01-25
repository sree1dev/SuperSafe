/*  ui.js  */
"use strict";
/* =========================================================
   UI — DRIVE-SYNCED, AUTO-REFRESHING
========================================================= */

document.addEventListener("DOMContentLoaded", bootUI);

/* ===================== STATE ===================== */

let els = {};
let readOnly = true;
let selectedFolderId = null;

/* ===================== BOOT ===================== */

function bootUI() {
  cacheElements();
  resetInitialState();
  wireLock();
  wireExplorer();
  wireToolbar();
  wireAdmin();

  // 🔁 auto refresh when Drive polling fires
  document.addEventListener("drive-refresh", async () => {
    if (drive.isReady()) {
      await renderExplorer();
    }
  });

  focusPassword();
}

/* ===================== CACHE ===================== */

function cacheElements() {
  const ids = [
    "lockScreen","passwordInput","unlockBtn","lockError",
    "app","explorer","tree","editor",
    "adminModal","changePwdModal",
    "adminBtn","logoutBtn",
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
  els.adminModal.classList.add("hidden");
  els.changePwdModal.classList.add("hidden");
  els.lockError.textContent = "";
}

function focusPassword() {
  els.passwordInput.focus();
  els.passwordInput.value = "";
}

/* ===================== LOCK / UNLOCK ===================== */

function wireLock() {
  els.unlockBtn.onclick = async () => {
    const pwd = els.passwordInput.value.trim();
    if (!pwd) {
      els.lockError.textContent = "Enter password";
      return;
    }

    try {
      await core.unlockVault(pwd);

      els.lockScreen.classList.add("hidden");
      els.app.classList.remove("hidden");
      readOnly = !core.isAdmin();

      // silent reconnect
      await drive.trySilentConnect();

      // wait until Drive is actually ready
      await waitForDrive();

      await renderExplorer();
    } catch {
      els.lockError.textContent = "Wrong password";
    }
  };
}

function waitForDrive() {
  return new Promise(resolve => {
    const check = () => {
      if (drive.isReady()) return resolve();
      setTimeout(check, 200);
    };
    check();
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
  };

  els.toggleExplorerBtn.onclick =
    () => els.explorer.classList.toggle("open");
}

async function renderExplorer() {
  els.tree.innerHTML = "";
  selectedFolderId = null;

  const rootId = core.driveRoot();
  if (!rootId || !drive.isReady()) return;

  const root = {
    id: rootId,
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
  label.textContent = node.name;
  label.style.color = color;

  row.appendChild(label);
  container.appendChild(row);

  if (!drive.isFolder(node)) {
    attachContextMenu(label, node);
    return;
  }

  label.onclick = () => {
    selectedFolderId = node.id;
  };

  const childrenBox = document.createElement("div");
  childrenBox.className = "tree-children";
  container.appendChild(childrenBox);

  const children = await drive.listChildren(node.id);
  for (const child of children) {
    await renderNode(child, childrenBox, color);
  }

  attachContextMenu(label, node);
}

/* ===================== CONTEXT MENU ===================== */

function attachContextMenu(el, node) {
  el.oncontextmenu = async e => {
    e.preventDefault();
    const action = prompt("rename / delete ?");
    if (!action) return;

    if (!core.isAdmin()) {
      alert("Admin only");
      return;
    }

    if (action === "delete") {
      const pwd = prompt("Admin password");
      try {
        await core.verifyAdmin(pwd);
        await drive.trash(node.id);
        await renderExplorer();
      } catch {}
    }

    if (action === "rename") {
      const name = prompt("New name");
      if (!name) return;
      await drive.rename(node.id, name);
      await renderExplorer();
    }
  };
}

/* ===================== TOOLBAR ===================== */

function wireToolbar() {
  els.adminBtn.onclick =
    () => els.adminModal.classList.remove("hidden");

  els.closeAdminBtn.onclick =
    () => els.adminModal.classList.add("hidden");

  els.logoutBtn.onclick =
    () => location.reload();
}

/* ===================== ADMIN ===================== */

function wireAdmin() {
  els.connectDriveBtn.onclick = async () => {
    await drive.connect();
    await waitForDrive();
    await renderExplorer();
  };

  els.openChangePwdBtn.onclick = () => {
    els.adminModal.classList.add("hidden");
    els.changePwdModal.classList.remove("hidden");
  };

  els.closeChangePwdBtn.onclick =
    () => els.changePwdModal.classList.add("hidden");

  els.changePwdConfirmBtn.onclick = async () => {
    els.changeError.textContent = "";

    const oldPwd = els.oldPwd.value;
    const newPwd = els.newPwd.value;
    const newPwd2 = els.newPwd2.value;

    if (!oldPwd || !newPwd || newPwd !== newPwd2) {
      els.changeError.textContent = "Password mismatch";
      return;
    }

    try {
      await core.verifyAdmin(oldPwd);
      await core.unlockVault(newPwd);
      els.changePwdModal.classList.add("hidden");
    } catch {
      els.changeError.textContent = "Invalid password";
    }
  };
}
