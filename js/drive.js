/* drive.js */
"use strict";
/* =========================================================
   DRIVE — METADATA + ENCRYPTED CONTENT I/O (CACHED)
========================================================= */

(() => {
  let tokenClient = null;
  let accessToken = null;
  let profileEmail = null;
  let driveReady = false;
  let pollTimer = null;

  const DRIVE_FOLDER_NAME = "SecureText";
  const POLL_INTERVAL = 10000;

  /* ===================== LOG ===================== */

  const log = (m, d) => LOG("DRIVE", m, d);

  /* ===================== IDB ===================== */

  const DB_NAME = "securetext";
  const STORE = "vault";

  function idbGet(key) {
    return new Promise(resolve => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onsuccess = e => {
        const db = e.target.result;
        const g = db.transaction(STORE).objectStore(STORE).get(key);
        g.onsuccess = () => resolve(g.result || null);
      };
    });
  }

  function idbPut(key, val) {
    const r = indexedDB.open(DB_NAME, 1);
    r.onsuccess = e => {
      e.target.result
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put(val, key);
    };
  }

  function idbDel(key) {
    const r = indexedDB.open(DB_NAME, 1);
    r.onsuccess = e => {
      e.target.result
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .delete(key);
    };
  }

  /* ===================== ENCRYPTED FILE CACHE ===================== */

  const memFileCache = new Map(); // fileId -> Uint8Array

  function cacheKey(fileId) {
    return `file:${fileId}`;
  }

  async function getCachedFile(fileId) {
    if (memFileCache.has(fileId)) {
      log("cache:mem-hit", fileId);
      return memFileCache.get(fileId);
    }

    const fromIdb = await idbGet(cacheKey(fileId));
    if (fromIdb) {
      log("cache:idb-hit", fileId);
      const bytes = new Uint8Array(fromIdb);
      memFileCache.set(fileId, bytes);
      return bytes;
    }

    return null;
  }

  function setCachedFile(fileId, bytes) {
    memFileCache.set(fileId, bytes);
    idbPut(cacheKey(fileId), [...bytes]);
  }

  function invalidateFileCache(fileId) {
    memFileCache.delete(fileId);
    idbDel(cacheKey(fileId));
  }

  /* ===================== OAUTH ===================== */

  function initClient() {
    if (tokenClient) return;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GOOGLE_CLIENT_ID,
      scope:
        "https://www.googleapis.com/auth/drive.metadata.readonly " +
        "https://www.googleapis.com/auth/drive.file " +
        "https://www.googleapis.com/auth/userinfo.email",
      callback: handleToken
    });

    log("oauth:init");
  }

  async function handleToken(resp) {
    if (!resp?.access_token) return;

    accessToken = resp.access_token;
    profileEmail = await fetchProfile();

    let rootId = await idbGet("driveRootId");
    if (!rootId) {
      rootId = await ensureRootFolder();
      idbPut("driveRootId", rootId);
    }

    core.setDriveRoot(rootId);
    driveReady = true;
    updateUI(true);
    startPolling();

    log("ready");
  }

  function connect() {
    initClient();
    tokenClient.requestAccessToken({ prompt: "consent" });
  }

  async function trySilentConnect() {
    const rootId = await idbGet("driveRootId");
    if (!rootId) return false;

    initClient();
    tokenClient.requestAccessToken({ prompt: "" });
    return true;
  }

  /* ===================== POLLING ===================== */

  function startPolling() {
    if (pollTimer) return;

    pollTimer = setInterval(() => {
      if (!driveReady) return;
      document.dispatchEvent(new CustomEvent("drive-refresh"));
      log("poll:refresh");
    }, POLL_INTERVAL);
  }

  /* ===================== PROFILE ===================== */

  async function fetchProfile() {
    const r = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return (await r.json()).email;
  }

  /* ===================== ROOT ===================== */

  async function ensureRootFolder() {
    const q =
      `name='${DRIVE_FOLDER_NAME}' and ` +
      `mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const r = await gFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`
    );

    if (r.files.length) return r.files[0].id;

    const c = await gFetch(
      "https://www.googleapis.com/drive/v3/files",
      "POST",
      {
        name: DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder"
      }
    );

    return c.id;
  }

  /* ===================== METADATA OPS ===================== */

  async function listChildren(parentId) {
    const q = `'${parentId}' in parents and trashed=false`;
    const r = await gFetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType)`
    );
    return r.files;
  }

  async function createFolder(name, parentId) {
    await gFetch("https://www.googleapis.com/drive/v3/files", "POST", {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    });
  }

  async function createFile(name, parentId) {
    await gFetch("https://www.googleapis.com/drive/v3/files", "POST", {
      name,
      mimeType: "application/octet-stream",
      parents: [parentId]
    });
  }

  async function rename(id, name) {
    await gFetch(
      `https://www.googleapis.com/drive/v3/files/${id}`,
      "PATCH",
      { name }
    );
  }

  async function trash(id) {
    invalidateFileCache(id);
    await gFetch(
      `https://www.googleapis.com/drive/v3/files/${id}`,
      "PATCH",
      { trashed: true }
    );
  }

  /* ===================== CONTENT I/O (CACHE-FIRST) ===================== */

  async function loadFile(fileId) {
    const cached = await getCachedFile(fileId);
    if (cached) {
      // background refresh
      refreshFileInBackground(fileId);
      return cached;
    }

    const bytes = await fetchFileFromDrive(fileId);
    setCachedFile(fileId, bytes);
    return bytes;
  }

  async function refreshFileInBackground(fileId) {
    try {
      const bytes = await fetchFileFromDrive(fileId);
      setCachedFile(fileId, bytes);
      log("cache:refresh", fileId);
    } catch {}
  }

  async function fetchFileFromDrive(fileId) {
    log("fetch:file", fileId);
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    return new Uint8Array(await r.arrayBuffer());
  }

  async function saveFile(fileId, bytes) {
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream"
        },
        body: bytes
      }
    );

    setCachedFile(fileId, bytes);
    log("save:file", fileId);
  }

  /* ===================== FETCH ===================== */

  async function gFetch(url, method = "GET", body) {
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  /* ===================== UI ===================== */

  function updateUI(connected) {
    const el = document.getElementById("driveStatus");
    if (el)
      el.textContent = connected
        ? `Connected (${profileEmail})`
        : "Not connected";
  }

  /* ===================== EXPORT ===================== */

  window.drive = {
    connect,
    trySilentConnect,
    listChildren,
    createFolder,
    createFile,
    rename,
    trash,
    loadFile,
    saveFile,
    isFolder: n => n.mimeType === "application/vnd.google-apps.folder",
    isReady: () => driveReady
  };
})();
