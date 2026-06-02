/**
 * Face recognition service — AWS Rekognition collection.
 * See CLAUDE.md "Face Recognition (Attendance Verification)".
 */
import { env } from '../../config/env.js';

export interface FaceMatchResult {
  matched: boolean;
  score: number; // 0-100 confidence
  faceId?: string;
}

/** Enroll a face into the Rekognition collection. Returns the stored faceId. */
export async function enrollFace(imageUrl: string): Promise<{ faceId: string }> {
  // TODO: rekognition.indexFaces({ CollectionId, Image }) -> FaceRecords[0].Face.FaceId
  void imageUrl;
  return { faceId: `face_TODO_${Date.now()}` };
}

/** Compare a selfie against enrolled templates. */
export async function verifyFace(selfieUrl: string, enrolledFaceId?: string): Promise<FaceMatchResult> {
  // TODO: rekognition.searchFacesByImage({ CollectionId, Image }) -> FaceMatches
  void selfieUrl;
  void enrolledFaceId;
  const score = 0;
  return { matched: score >= env.FACE_MATCH_THRESHOLD, score };
}
