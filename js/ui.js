"use strict";

/* =========================================================
   UI — DRIVE MIRROR TREE + MODALS (STABLE)
========================================================= */

/* ===================== GLOBALS ===================== */

let els = {};
let readOnly = true;

const folderColors = new Map();
let colorIndex = 0;

const COLORS = [
  "#4FC3F7", "#81C784", "#FFB74D",
  "#BA68C8", "#E57373", "#64B5F6",
  "#AED581", "#FFD54F"
];

/* ===================== BOOT ===================== */

document.addEventListener("DOMContentLoaded", () => {
  LOG("UI", "boot:start");
  cache();
  resetUI();
  wireLock();
  wireExplorer();
  wireToolbar();
  wireAdmin();
  focusPassword();
  LOG("UI", "boot:ready");
});

/* ===================== CACHE ===================== */

function cache() {
  [
    "lockScreen","passwordInput","lockError","app",
    "explorer","tree","editor","adminModal",
    "changePwdModal","openChangePwdBtn",
    "closeAdminBtn","connectDriveBtn",
    "uploadVaultBtn","downloadVaultBtn",
    "adminBtn","logoutBtn","newFolderBtn",
    "newFileBtn","toggleExplorerBtn"
  ].forEach(id => els[id] = document.getElementById(id));

  LOG("UI", "dom:cached");
}

/* ===================== RESET ===================== */

function resetUI() {
  els.lockScreen.classList.remove("hidden");
  els.app.classList.add("hidden");
  els.adminModal.classList.add("hidden");
  els.changePwdModal.classList.add("hidden");
  LOG("UI", "state:reset");
}

function focusPassword() {
  els.passwordInput.focus();
  LOG("UI", "focus:password");
}

/* ===================== LOCK ===================== */

function wireLock() {
  els.passwordInput.addEventListener("input", async () => {
    const pwd = els.passwordInput.value.trim();
    if (!pwd) return;

    LOG("UI", "unlock:attempt");

    try {
      await core.unlockVault(pwd);

      readOnly = !APP_STATE.admin.initialized;

      els.lockScreen.classList.add("hidden");
      els.app.classList.remove("hidden");

      await renderExplorer();

      LOG("UI", "unlock:success", { readOnly });
    } catch (e) {
      els.lockError.textContent = "Wrong password";
      LOG("UI", "unlock:fail", e.message);
    }
  });
}

/* ===================== EXPLORER ===================== */

function wireExplorer() {
  els.newFolderBtn.onclick = async () => {
    const name = prompt("Folder name");
    if (!name) return;

    LOG("UI", "folder:create", name);
    await drive.createFolder(name, core.driveRoot());
    await renderExplorer();
  };

  els.newFileBtn.onclick = async () => {
    const name = prompt("File name");
    if (!name) return;

    LOG("UI", "file:create", name);
    await drive.createFile(name, core.driveRoot());
    await renderExplorer();
  };

  els.toggleExplorerBtn.onclick =
    () => els.explorer.classList.toggle("open");
}

async function renderExplorer() {
  els.tree.innerHTML = "";
  folderColors.clear();
  colorIndex = 0;

  const rootId = core.driveRoot();
  if (!rootId) return;

  const root = {
    id: rootId,
    name: "Root",
    mimeType: "application/vnd.google-apps.folder"
  };

  await renderNode(root, els.tree, null);
  LOG("UI", "explorer:render");
}

async function renderNode(node, container, parentColor) {
  const color = getColor(node, parentColor);

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.setProperty("--line-color", color);

  const label = document.createElement("div");
  label.className = "tree-label";
  label.textContent = node.name;
  label.style.color = color;

  row.appendChild(label);
  container.appendChild(row);

  attachDelete(label, node.id);

  if (node.mimeType !== "application/vnd.google-apps.folder") {
    label.onclick = () => LOG("UI", "file:select", node.name);
    return;
  }

  const childrenBox = document.createElement("div");
  childrenBox.className = "tree-children";
  container.appendChild(childrenBox);

  label.onclick = () => childrenBox.classList.toggle("hidden");

  const kids = await drive.listChildren(node.id);
  for (const child of kids) {
    await renderNode(child, childrenBox, color);
  }
}

/* ===================== COLORS ===================== */

function getColor(node, parentColor) {
  if (node.mimeType !== "application/vnd.google-apps.folder") {
    return parentColor || "#aaa";
  }

  if (!folderColors.has(node.id)) {
    folderColors.set(
      node.id,
      COLORS[colorIndex++ % COLORS.length]
    );
  }
  return folderColors.get(node.id);
}

/* ===================== DELETE ===================== */

function attachDelete(el, id) {
  el.oncontextmenu = async e => {
    e.preventDefault();
    LOG("UI", "delete:attempt", id);

    const pwd = prompt("Admin password to delete");
    if (!pwd) return;

    try {
      await core.verifyAdmin(pwd);
      await drive.trash(id);
      await renderExplorer();
      LOG("UI", "delete:trashed", id);
    } catch {
      LOG("UI", "delete:denied");
    }
  };
}

/* ===================== TOOLBAR ===================== */

function wireLock() {
  els.passwordInput.addEventListener("keydown", async e => {
    if (e.key !== "Enter") return;

    const pwd = els.passwordInput.value.trim();
    if (!pwd) return;

    LOG("UI", "unlock:attempt");

    try {
      const ok = await core.unlockVault(pwd);
      if (!ok) throw new Error("wrong-password");

      readOnly = !APP_STATE.admin.initialized;

      els.lockScreen.classList.add("hidden");
      els.app.classList.remove("hidden");

      await renderExplorer();

      LOG("UI", "unlock:success", { readOnly });
    } catch (err) {
      els.lockError.textContent = "Wrong password";
      LOG("UI", "unlock:fail", err.message);
    }
  });
}

/* ===================== ADMIN ===================== */

function wireAdmin() {
  els.openChangePwdBtn.onclick = () => {
    els.adminModal.classList.add("hidden");
    els.changePwdModal.classList.remove("hidden");
    LOG("UI", "password:change-open");
  };

  els.connectDriveBtn.onclick = async () => {
    LOG("UI", "drive:connect-click");
    await drive.connect(els.passwordInput.value);
    await renderExplorer();
  };
}
