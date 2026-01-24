"use strict";
/* ================= GOOGLE CONFIG ================= */

const GDRIVE_CLIENT_ID =
  "628807779499-ql68bc363klkaiuesakd1eknc38qmcah.apps.googleusercontent.com";

const GDRIVE_SCOPE =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/drive.file";

const VAULT_FOLDER_NAME = "SecureText";
const VAULT_FILENAME = "vault.stx";

/* ================= OAUTH ================= */

function gAuth() {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GDRIVE_CLIENT_ID,
      scope: GDRIVE_SCOPE,
      callback: resp => {
        if (resp.error) {
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

/* ================= DRIVE ================= */

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

async function findVaultFile() {
  const q = encodeURIComponent(
    `name='${VAULT_FILENAME}' and '${vaultFolderId}' in parents and trashed=false`
  );

  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );

  const js = await res.json();
  return js.files[0] || null;
}

/* ================= ADMIN CONNECT ================= */

async function connectDriveAsAdmin() {
  await gAuth();

  const info = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${gToken}` } }
  );
  const profile = await info.json();

  if (!vaultData.admin.initialized) {
    vaultData.admin.initialized = true;
    vaultData.admin.googleEmail = profile.email;
  } else if (vaultData.admin.googleEmail !== profile.email) {
    throw new Error("Vault locked to another Google account");
  }

  vaultFolderId = await ensureVaultFolder();
}

/* ================= SAVE / LOAD ================= */

async function saveVaultRemote() {
  const encrypted = await encryptVault(MASTER_PASSWORD, vaultData);
  dbPut("vault", encrypted);

  const existing = await findVaultFile();
  const boundary = "vault_boundary";

  const body =
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    JSON.stringify({ name: VAULT_FILENAME, parents: [vaultFolderId] }) +
    `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n` +
    JSON.stringify(encrypted) +
    `\r\n--${boundary}--`;

  const url = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  await gFetch(url, {
    method: existing ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
}

async function loadVaultRemote() {
  const remote = await findVaultFile();
  if (!remote) throw new Error("No vault found");

  const res = await gFetch(
    `https://www.googleapis.com/drive/v3/files/${remote.id}?alt=media`
  );
  const encrypted = await res.json();

  vaultData = await decryptVault(MASTER_PASSWORD, encrypted);
  dbPut("vault", encrypted);

  renderTree();
  restoreLastFile();
}
