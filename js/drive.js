"use strict";

/* =========================================================
   DRIVE — GOOGLE DRIVE MIRROR LAYER
========================================================= */

(() => {
  const CLIENT_ID =
    "628807779499-ql68bc363klkaiuesakd1eknc38qmcah.apps.googleusercontent.com";

  const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
    "profile"
  ].join(" ");

  let accessToken = null;

  /* ===================== AUTH ===================== */

  function auth() {
    LOG("DRIVE", "oauth:start");

    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: token => {
          if (token.error) {
            LOG("DRIVE", "oauth:error", token.error);
            reject(token);
            return;
          }
          accessToken = token.access_token;
          LOG("DRIVE", "oauth:success");
          resolve();
        }
      });

      client.requestAccessToken();
    });
  }

  function gfetch(url, opts = {}) {
    return fetch(url, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${accessToken}`
      }
    });
  }

  /* ===================== PROFILE ===================== */

  async function fetchProfile() {
    LOG("DRIVE", "profile:fetch");

    const r = await gfetch(
      "https://www.googleapis.com/oauth2/v3/userinfo"
    );
    const p = await r.json();

    LOG("DRIVE", "profile:ok", p.email);
    return p.email;
  }

  /* ===================== ROOT FOLDER ===================== */

  async function ensureRoot() {
    LOG("DRIVE", "root:ensure");

    const q = encodeURIComponent(
      "name='SecureText' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    );

    const r = await gfetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
    );
    const j = await r.json();

    if (j.files.length) {
      LOG("DRIVE", "root:found", j.files[0].id);
      return j.files[0].id;
    }

    LOG("DRIVE", "root:create");

    const c = await gfetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "SecureText",
          mimeType: "application/vnd.google-apps.folder"
        })
      }
    );

    const created = await c.json();
    LOG("DRIVE", "root:created", created.id);
    return created.id;
  }

  /* ===================== LIST ===================== */

  async function listChildren(parentId) {
    LOG("DRIVE", "list", parentId);

    const q = encodeURIComponent(
      `'${parentId}' in parents and trashed=false`
    );

    const r = await gfetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)`
    );

    const j = await r.json();
    return j.files;
  }

  /* ===================== CREATE ===================== */

  async function createFolder(name, parentId) {
    LOG("DRIVE", "folder:create", name);

    const r = await gfetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parents: [parentId],
          mimeType: "application/vnd.google-apps.folder"
        })
      }
    );

    return r.json();
  }

  async function createFile(name, parentId) {
    LOG("DRIVE", "file:create", name);

    const r = await gfetch(
      "https://www.googleapis.com/drive/v3/files",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          parents: [parentId],
          mimeType: "application/octet-stream"
        })
      }
    );

    return r.json();
  }

  /* ===================== RENAME ===================== */

  async function rename(id, name) {
    LOG("DRIVE", "rename", { id, name });

    await gfetch(
      `https://www.googleapis.com/drive/v3/files/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      }
    );
  }

  /* ===================== DELETE (TRASH ONLY) ===================== */

  async function trash(id) {
    LOG("DRIVE", "trash", id);

    await gfetch(
      `https://www.googleapis.com/drive/v3/files/${id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashed: true })
      }
    );
  }

  /* ===================== CONNECT FLOW ===================== */

  async function connectDrive(password) {
    LOG("DRIVE", "connect:start");

    await auth();
    const email = await fetchProfile();

    if (!core.isAdmin()) {
      core.setAdmin(email);
      await core.saveVault(password);
    }

    const rootId = await ensureRoot();
    core.setDriveRoot(rootId);
    await core.saveVault(password);

    LOG("DRIVE", "connect:done");
  }

  /* ===================== EXPORT ===================== */

  window.drive = {
    connect: connectDrive,
    listChildren,
    createFolder,
    createFile,
    rename,
    trash
  };
})();
