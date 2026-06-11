/**
 * Diagnostic for the Rekognition face pipeline. Reports, for a given image:
 *   1. DetectFaces  — is a face even found? pose (roll/yaw/pitch), quality.
 *   2. SearchFacesByImage at threshold 0 — the REAL best similarity + which
 *      employee (ExternalImageId) it matched, ignoring the 85% cutoff.
 *
 * Usage: npx tsx scripts/diagnose-face.ts <image-path>
 */
import 'dotenv/config';
import { promises as fs } from 'fs';
import {
  RekognitionClient,
  DetectFacesCommand,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';

const region = process.env.AWS_REGION ?? 'ap-south-1';
const collectionId = process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'hr-payroll-faces';
const imgPath = process.argv[2];

async function main() {
  if (!imgPath) throw new Error('Pass an image path: npx tsx scripts/diagnose-face.ts <path>');
  const bytes = await fs.readFile(imgPath);
  const rek = new RekognitionClient({
    region,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
    },
  });

  console.log(`\nImage: ${imgPath}  (${bytes.length} bytes)\n`);

  // 1. DetectFaces
  try {
    const det = await rek.send(new DetectFacesCommand({ Image: { Bytes: bytes }, Attributes: ['DEFAULT'] }));
    const faces = det.FaceDetails ?? [];
    console.log(`DetectFaces: ${faces.length} face(s)`);
    faces.forEach((f, i) => {
      const p = f.Pose;
      const q = f.Quality;
      console.log(
        `  face ${i + 1}: conf ${f.Confidence?.toFixed(1)}%  ` +
          `pose roll=${p?.Roll?.toFixed(0)} yaw=${p?.Yaw?.toFixed(0)} pitch=${p?.Pitch?.toFixed(0)}  ` +
          `quality bright=${q?.Brightness?.toFixed(0)} sharp=${q?.Sharpness?.toFixed(0)}`,
      );
    });
  } catch (e) {
    console.log(`DetectFaces failed: ${(e as { name?: string }).name} — ${(e as { message?: string }).message}`);
  }

  // 2. SearchFacesByImage at threshold 0 (see the true best match)
  try {
    const res = await rek.send(
      new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: { Bytes: bytes },
        FaceMatchThreshold: 0,
        MaxFaces: 5,
      }),
    );
    const matches = res.FaceMatches ?? [];
    console.log(`\nSearchFacesByImage (threshold 0): ${matches.length} match(es)`);
    matches.forEach((m) =>
      console.log(`  similarity ${m.Similarity?.toFixed(1)}%  -> employee ${m.Face?.ExternalImageId}`),
    );
    if (!matches.length) console.log('  (no faces enrolled in collection, or none comparable)');
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'InvalidParameterException') {
      console.log('\nSearchFacesByImage: NO FACE DETECTED in this image (Rekognition could not find a face).');
    } else {
      console.log(`\nSearchFacesByImage failed: ${name} — ${(e as { message?: string }).message}`);
    }
  }
  console.log('');
}

main();
