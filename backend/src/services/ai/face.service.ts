/**
 * Face recognition service — AWS Rekognition collection.
 * See CLAUDE.md "Face Recognition (Attendance Verification)".
 *
 * Works on raw image bytes (Buffer). Gracefully no-ops when AWS credentials are
 * absent so attendance still works locally.
 *
 * Every call names the collection to use. Each tenant has its own, which is the
 * isolation boundary for faces: a search can only ever match a face enrolled by
 * the same dealer, so one dealer's employee can never be recognised as — or
 * blocked by — another dealer's.
 */
import {
  RekognitionClient,
  CreateCollectionCommand,
  IndexFacesCommand,
  SearchFacesByImageCommand,
  DeleteFacesCommand,
} from '@aws-sdk/client-rekognition';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export interface FaceMatchResult {
  enabled: boolean; // false when AWS isn't configured
  matched: boolean; // top match is this employee AND >= threshold
  score: number; // 0-100 similarity of the best match
  matchedEmployeeId?: string;
}

/** Face matching is active only when AWS credentials are present. */
export function isFaceMatchEnabled(): boolean {
  return !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

let _client: RekognitionClient | null = null;
/**
 * Collections this process has already created. A Set, not a boolean: each
 * tenant has its own collection, so "already ensured" is per collection id.
 */
const _collectionsReady = new Set<string>();

function client(): RekognitionClient {
  if (!_client) {
    _client = new RekognitionClient({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return _client;
}

/** Create a tenant's Rekognition collection once per process (idempotent). */
export async function ensureCollection(collectionId: string): Promise<void> {
  if (_collectionsReady.has(collectionId)) return;
  try {
    await client().send(new CreateCollectionCommand({ CollectionId: collectionId }));
    logger.info({ collection: collectionId }, 'Created Rekognition collection');
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== 'ResourceAlreadyExistsException') throw err;
  }
  _collectionsReady.add(collectionId);
}

/**
 * Enroll an employee's face. ExternalImageId is set to the employeeId so a later
 * search tells us *who* a selfie matched. Returns the Rekognition FaceId.
 */
export async function enrollFace(
  image: Buffer,
  employeeId: string,
  collectionId: string,
): Promise<{ faceId: string }> {
  if (!isFaceMatchEnabled()) throw new Error('AWS Rekognition is not configured');
  await ensureCollection(collectionId);
  const res = await client().send(
    new IndexFacesCommand({
      CollectionId: collectionId,
      Image: { Bytes: image },
      ExternalImageId: employeeId,
      DetectionAttributes: [],
      MaxFaces: 1,
      QualityFilter: 'AUTO',
    }),
  );
  const faceId = res.FaceRecords?.[0]?.Face?.FaceId;
  if (!faceId) throw new Error('No face detected in the enrollment image');
  return { faceId };
}

/** Remove a previously enrolled face (re-enrollment / off-boarding). */
export async function removeFace(faceId: string, collectionId: string): Promise<void> {
  if (!isFaceMatchEnabled()) return;
  await client().send(new DeleteFacesCommand({ CollectionId: collectionId, FaceIds: [faceId] }));
}

/**
 * Search the collection for a selfie. Returns the best match and whether it is
 * the expected employee at or above the configured threshold.
 */
export async function verifyFace(
  selfie: Buffer,
  expectedEmployeeId: string,
  collectionId: string,
  threshold: number = env.FACE_MATCH_THRESHOLD,
): Promise<FaceMatchResult> {
  if (!isFaceMatchEnabled()) return { enabled: false, matched: false, score: 0 };
  await ensureCollection(collectionId);
  try {
    const res = await client().send(
      new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: { Bytes: selfie },
        FaceMatchThreshold: threshold,
        MaxFaces: 1,
      }),
    );
    const top = res.FaceMatches?.[0];
    const score = Math.round(top?.Similarity ?? 0);
    const matchedEmployeeId = top?.Face?.ExternalImageId;
    const matched = !!top && matchedEmployeeId === expectedEmployeeId && score >= threshold;
    return { enabled: true, matched, score, matchedEmployeeId };
  } catch (err) {
    // No face / no match in the collection -> treat as unmatched, don't throw (never block).
    const name = (err as { name?: string }).name;
    if (name === 'InvalidParameterException') return { enabled: true, matched: false, score: 0 };
    throw err;
  }
}
