/**
 * Serving a stored upload must not become a way to read the filesystem.
 *
 * Three routes resolve a path that comes out of the database — a claim receipt,
 * an employee photo, a check-in selfie. The guard was `startsWith('/uploads/')`
 * followed by `path.resolve`, and `/uploads/../../etc/passwd` passes that.
 *
 * Nothing exploited it: every write to those columns is server-generated, and
 * the employee update parses through a Zod object schema, which strips unknown
 * keys — so the path fields cannot be posted in. These tests are so that stays
 * true no matter what a later schema change allows.
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveUploadPath } from '../src/utils/upload-path.js';

const UPLOADS = path.resolve(process.cwd(), 'uploads');

describe('resolving a stored upload path', () => {
  it('accepts an ordinary stored path', () => {
    expect(resolveUploadPath('/uploads/claims/abc-photo-1.jpg')).toBe(
      path.join(UPLOADS, 'claims', 'abc-photo-1.jpg'),
    );
  });

  it('accepts one without the leading slash', () => {
    expect(resolveUploadPath('uploads/selfies/x.jpg')).toBe(path.join(UPLOADS, 'selfies', 'x.jpg'));
  });

  it('refuses climbing out of the uploads directory', () => {
    expect(() => resolveUploadPath('/uploads/../../etc/passwd')).toThrow();
    expect(() => resolveUploadPath('/uploads/../.env')).toThrow();
    expect(() => resolveUploadPath('/uploads/claims/../../../../etc/hosts')).toThrow();
  });

  it('refuses an absolute path that never touches uploads', () => {
    expect(() => resolveUploadPath('/etc/passwd')).toThrow();
    expect(() => resolveUploadPath('/backend/.env')).toThrow();
  });

  it('refuses a sibling directory that merely starts the same way', () => {
    // The reason this uses path.relative rather than a startsWith on the
    // resolved string: "/uploads-old/secret" has the uploads path as a string
    // prefix but is a different directory.
    expect(() => resolveUploadPath('/uploads-old/secret.jpg')).toThrow();
  });

  it('refuses the uploads directory itself', () => {
    expect(() => resolveUploadPath('/uploads/')).toThrow();
  });

  it('reports not-found, so a probe learns nothing about what exists', () => {
    try {
      resolveUploadPath('/uploads/../../etc/passwd');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { statusCode?: number }).statusCode).toBe(404);
    }
  });
});
