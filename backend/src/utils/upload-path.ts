/**
 * Resolving a stored `/uploads/...` path without letting it escape.
 *
 * Three routes serve files whose path comes out of the database — a claim's
 * receipt, an employee's photo, a check-in selfie. Each did:
 *
 *     if (url.startsWith('/uploads/')) path.resolve(process.cwd(), url.slice(1))
 *
 * and `/uploads/../../etc/passwd` satisfies that guard. Nothing exploits it
 * today: every write to those columns is server-generated, and the employee
 * update parses with a Zod object schema, which strips unknown keys — so
 * `faceTemplateUrl` cannot be posted in. But the guard is one careless schema
 * change away from being a file-read primitive, and the check costs nothing.
 */
import path from 'path';
import { AppError } from './AppError.js';

const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

/**
 * Absolute path for a stored upload URL, or a 404 if it points outside the
 * uploads directory.
 *
 * `path.relative` rather than a `startsWith` on the resolved string: a prefix
 * test also accepts a sibling directory whose name merely begins the same way
 * (`/uploads-old/`), which is the classic way this check is written wrong.
 *
 * Not found, not forbidden — a traversal attempt should learn nothing about
 * what is or is not there.
 */
export function resolveUploadPath(url: string): string {
  const abs = path.resolve(process.cwd(), url.replace(/^\//, ''));
  const rel = path.relative(UPLOADS_ROOT, abs);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw AppError.notFound('File');
  }
  return abs;
}
