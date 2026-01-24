"use strict";
lockScreen.classList.remove("hidden");
app.classList.add("hidden");
adminModal.classList.add("hidden");
changePwdModal.classList.add("hidden");
document.addEventListener("DOMContentLoaded", () => {

(function domSanityGuard() {
  const ids = {};
  document.querySelectorAll("[id]").forEach(el => {
    if (ids[el.id]) {
      console.error("DUPLICATE ID:", el.id, el);
      alert("Fatal DOM error: duplicate id → " + el.id);
    }
    ids[el.id] = true;
  });
})();

  
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

  /* ADMIN */

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
    /* 🔒 FORCE INITIAL STATE */
  adminModal.classList.add("hidden");
  changePwdModal.classList.add("hidden");

  console.log("UI ready, modals hidden");

  /* ================= UNLOCK ================= */

  passwordInput.oninput = async () => {
    if (passwordInput.value.length < MASTER_PASSWORD.length) return;

    try {
      await unlockVaultFlow(passwordInput.value);
      lockScreen.remove();
      app.classList.remove("hidden");
    } catch {
      lockError.textContent = "Wrong password";
    }
  };

  /* ================= EXPLORER ================= */

  toggleExplorerBtn.onclick = () =>
    explorer.classList.toggle("open");

  newFolderBtn.onclick = () => {
    const name = prompt("Folder name");
    if (name) createFolder(name);
  };

  newFileBtn.onclick = () => {
    const name = prompt("File name");
    if (name) createFile(name);
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

  /* ================= LOCAL SAVE ================= */

  encryptBtn.onclick = async () => {
    await saveLocal();
  };

  editor.addEventListener("input", () => {
    if (!currentNode) return;
    currentNode.content = editor.innerHTML;
    vaultData.updatedAt = Date.now();
  });

  /* ================= ADMIN ================= */

  adminBtn.onclick = () => {
    adminModal.classList.remove("hidden");
    refreshAdminUI();
  };

  closeAdminBtn.onclick = () =>
    adminModal.classList.add("hidden");

  openChangePwdBtn.onclick = () => {
    adminModal.classList.add("hidden");
    changePwdModal.classList.remove("hidden");
  };

  changePwdConfirmBtn.onclick = async () => {
    if (!vaultData.admin.initialized) {
      alert("Only admin can change password");
      return;
    }

    if (oldPwd.value !== MASTER_PASSWORD) {
      changeError.textContent = "Wrong password";
      return;
    }

    if (!newPwd.value || newPwd.value !== newPwd2.value) {
      changeError.textContent = "Passwords do not match";
      return;
    }

    MASTER_PASSWORD = newPwd.value;

    const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
    dbPut("vault", encrypted);

    await saveVaultRemote();

    oldPwd.value = newPwd.value = newPwd2.value = "";
    changeError.textContent = "";
    changePwdModal.classList.add("hidden");

    alert("Vault re-encrypted");
  };

  /* ================= DRIVE ================= */

  connectDriveBtn.onclick = async () => {
    try {
      await connectDriveAsAdmin();
      refreshAdminUI();
    } catch {
      alert("Google authentication failed");
    }
  };

  uploadVaultBtn.onclick = async () => {
    await saveVaultRemote();
    alert("Vault uploaded");
  };

  downloadVaultBtn.onclick = async () => {
    await loadVaultRemote();
    alert("Vault downloaded");
  };

  function refreshAdminUI() {
    const ok = vaultData.admin.initialized;

    driveStatus.textContent = ok
      ? `Locked to ${vaultData.admin.googleEmail}`
      : "Not connected";

    uploadVaultBtn.disabled = !ok;
    downloadVaultBtn.disabled = !ok;
    openChangePwdBtn.disabled = !ok;
  }

  /* ================= LOGOUT ================= */

  logoutBtn.onclick = () => location.reload();

});
