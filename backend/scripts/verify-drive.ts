/**
 * Live Google Drive check for claim storage. Uses the same drive.service code path
 * as real claims: ensure per-employee folder ("<Name> - <CODE>") → upload a photo
 * + a PDF → list the folder back. Cleans up after itself unless --keep is passed.
 *
 *   npx tsx scripts/verify-drive.ts          # test + cleanup
 *   npx tsx scripts/verify-drive.ts --keep   # leave the test folder in Drive
 */
import 'dotenv/config';
import {
  isDriveEnabled,
  ensureEmployeeFolder,
  uploadToDrive,
  listFolder,
  deleteDriveFile,
} from '../src/services/storage/drive.service.js';

const keep = process.argv.includes('--keep');

// Tiny valid JPEG + PDF payloads (content doesn't matter, existence does).
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF',
);

async function main() {
  if (!isDriveEnabled()) throw new Error('Drive not configured (set GOOGLE_SERVICE_ACCOUNT_FILE or OAuth vars)');

  console.log('\n1) ensureEmployeeFolder("TEST01", "Drive Test") …');
  const folderId = await ensureEmployeeFolder('TEST01', 'Drive Test');
  console.log(`   ✓ folder id: ${folderId}  (name should be "Drive Test - TEST01")`);

  console.log('2) upload photo + pdf …');
  const photoId = await uploadToDrive(JPG, 'photo-test.jpg', 'image/jpeg', folderId);
  const pdfId = await uploadToDrive(PDF, 'doc-test.pdf', 'application/pdf', folderId);
  console.log(`   ✓ photo: ${photoId}\n   ✓ pdf:   ${pdfId}`);

  console.log('3) list folder back …');
  const files = await listFolder(folderId);
  files.forEach((f) => console.log(`   • ${f.name}  (${f.mimeType}, ${f.size ?? '?'} bytes)`));

  const ok = files.some((f) => f.name === 'photo-test.jpg') && files.some((f) => f.name === 'doc-test.pdf');
  console.log(ok ? '\n✅ Drive storage WORKS — files land in the per-employee folder.' : '\n✗ Files missing from folder listing!');

  if (!keep) {
    await deleteDriveFile(photoId);
    await deleteDriveFile(pdfId);
    await deleteDriveFile(folderId);
    console.log('   (test files + folder cleaned up)');
  } else {
    console.log('   (kept — check "Shared with me" in your Google Drive)');
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('\n✗ Drive test failed:', e?.errors?.[0]?.message ?? e.message);
  process.exit(1);
});
