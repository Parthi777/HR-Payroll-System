/**
 * Google Drive storage for claim attachments (photos + PDFs).
 *
 * Auth modes (checked in order):
 *   1. Service account — GOOGLE_SERVICE_ACCOUNT_FILE (path) or GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON).
 *   2. OAuth2 refresh token — files land in the connected Gmail's Drive.
 *
 * Layout: one folder per employee named "<Employee Name> - <Employee Code>",
 * under GOOGLE_DRIVE_PARENT_FOLDER_ID when set. Folders created by a service
 * account are auto-shared with GOOGLE_DRIVE_SHARE_WITH so they appear in the
 * HR admin's "Shared with me".
 *
 * Files are kept PRIVATE (no public links) — the app streams them back through an
 * authenticated backend route. Callers check isDriveEnabled() and fall back to
 * S3/local storage when Drive isn't configured.
 */
import { google, type drive_v3 } from 'googleapis';
import { readFileSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function hasServiceAccount(): boolean {
  return !!(env.GOOGLE_SERVICE_ACCOUNT_FILE || env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function isDriveEnabled(): boolean {
  return (
    hasServiceAccount() ||
    !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_OAUTH_REFRESH_TOKEN)
  );
}

let _drive: drive_v3.Drive | null = null;
function drive(): drive_v3.Drive {
  if (_drive) return _drive;

  if (hasServiceAccount()) {
    const credentials = env.GOOGLE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)
      : JSON.parse(readFileSync(path.resolve(process.cwd(), env.GOOGLE_SERVICE_ACCOUNT_FILE as string), 'utf8'));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: [DRIVE_SCOPE] });
    _drive = google.drive({ version: 'v3', auth });
  } else {
    const auth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
    _drive = google.drive({ version: 'v3', auth });
  }
  return _drive;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Best-effort: share a folder with the HR admin so it shows in "Shared with me". */
async function shareFolder(folderId: string): Promise<void> {
  if (!env.GOOGLE_DRIVE_SHARE_WITH) return;
  try {
    await drive().permissions.create({
      fileId: folderId,
      requestBody: { type: 'user', role: 'writer', emailAddress: env.GOOGLE_DRIVE_SHARE_WITH },
      sendNotificationEmail: false,
    });
  } catch (err) {
    logger.warn({ folderId, err }, 'Could not share Drive folder');
  }
}

/**
 * Find-or-create the Drive folder for an employee, named
 * "<Employee Name> - <Employee Code>" (e.g. "Ravi Kumar - EMP001").
 * Returns the folder id; cache it on Employee.driveFolderId.
 */
export async function ensureEmployeeFolder(employeeCode: string, employeeName: string): Promise<string> {
  const name = `${employeeName} - ${employeeCode}`;
  const parent = env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  const parentClause = parent ? ` and '${parent}' in parents` : '';
  const existing = await drive().files.list({
    q: `mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}' and trashed=false${parentClause}`,
    fields: 'files(id)',
    spaces: 'drive',
  });
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await drive().files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined },
    fields: 'id',
  });
  const id = created.data.id;
  if (!id) throw new Error('Failed to create employee Drive folder');
  await shareFolder(id);
  logger.info({ employeeCode, folderId: id }, 'Created Drive folder for employee claims');
  return id;
}

/** Upload bytes into the employee's folder. Returns the Drive file id. */
export async function uploadToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderId: string,
): Promise<string> {
  const res = await drive().files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
  if (!res.data.id) throw new Error('Drive upload returned no file id');
  return res.data.id;
}

/** Stream a Drive file's bytes (for the authenticated download proxy). */
export async function getDriveFileStream(
  fileId: string,
): Promise<{ stream: Readable; mimeType: string; name: string }> {
  const meta = await drive().files.get({ fileId, fields: 'name, mimeType' });
  const res = await drive().files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );
  return {
    stream: res.data as unknown as Readable,
    mimeType: meta.data.mimeType ?? 'application/octet-stream',
    name: meta.data.name ?? fileId,
  };
}

/** Delete a Drive file (off-boarding / claim removal). Best-effort. */
export async function deleteDriveFile(fileId: string): Promise<void> {
  try {
    await drive().files.delete({ fileId });
  } catch (err) {
    logger.warn({ fileId, err }, 'Failed to delete Drive file');
  }
}

/** List a folder's contents (used by verification tooling). */
export async function listFolder(folderId: string) {
  const res = await drive().files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType, size)',
  });
  return res.data.files ?? [];
}
