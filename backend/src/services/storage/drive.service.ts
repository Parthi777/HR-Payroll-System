/**
 * Google Drive storage for claim attachments (photos + PDFs), per CLAUDE.md-style
 * private storage. Uses OAuth2 (refresh token) so files land in the connected
 * Gmail's Drive. Layout: one folder per employee under an optional parent folder.
 *
 * Files are kept PRIVATE (no public sharing) — the app streams them back through an
 * authenticated backend route using these helpers. Falls back gracefully: callers
 * check isDriveEnabled() and use S3/local storage when Drive isn't configured.
 */
import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'stream';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export function isDriveEnabled(): boolean {
  return !!(
    env.GOOGLE_OAUTH_CLIENT_ID &&
    env.GOOGLE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

let _drive: drive_v3.Drive | null = null;
function drive(): drive_v3.Drive {
  if (!_drive) {
    const auth = new google.auth.OAuth2(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET);
    auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });
    _drive = google.drive({ version: 'v3', auth });
  }
  return _drive;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Find-or-create the Drive folder for an employee (named "Claims - <code> (<name>)").
 * Returns the folder id. Cache it on Employee.driveFolderId to avoid repeat lookups.
 */
export async function ensureEmployeeFolder(employeeCode: string, employeeName: string): Promise<string> {
  const name = `Claims - ${employeeCode} (${employeeName})`;
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
