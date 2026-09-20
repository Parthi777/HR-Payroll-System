/**
 * Face liveness for the branch kiosk — proving there is a live person in front
 * of the tablet, not a photograph of one.
 *
 * The Android app does this itself with on-device face detection and a blink
 * prompt. A browser has nothing equivalent, so the kiosk uses AWS Rekognition
 * Face Liveness: the tablet streams a short check straight to AWS, and this
 * server asks AWS afterwards how it went and takes the reference image from the
 * result. The selfie stored against the punch is therefore an image AWS itself
 * captured during a check it scored, rather than any frame the browser chose to
 * send.
 *
 * The browser needs AWS credentials to open that stream. It is given
 * short-lived federated ones whose policy allows exactly one action, minted
 * here; the real keys never leave the server. See docs/KIOSK.md for the IAM
 * permissions this needs.
 *
 * With KIOSK_LIVENESS=off (or no AWS credentials at all) every function here
 * reports "not enabled" and the kiosk falls back to a plain capture, which is
 * what makes the whole flow testable without a camera.
 */
import {
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';
import { GetFederationTokenCommand, STSClient } from '@aws-sdk/client-sts';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

/** Where the liveness session runs. Falls back to the collection's region. */
export function livenessRegion(): string {
  return env.AWS_LIVENESS_REGION ?? env.AWS_REGION;
}

export function isLivenessEnabled(): boolean {
  return (
    env.KIOSK_LIVENESS === 'aws' &&
    Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
  );
}

function credentials() {
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID as string,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
  };
}

function rekognition(): RekognitionClient {
  return new RekognitionClient({ region: livenessRegion(), credentials: credentials() });
}

/** Start a check. The id is handed to the tablet, which streams to AWS itself. */
export async function createLivenessSession(): Promise<string> {
  if (!isLivenessEnabled()) throw new AppError('Liveness checking is not configured', 503);
  const res = await rekognition().send(
    new CreateFaceLivenessSessionCommand({ Settings: { AuditImagesLimit: 1 } }),
  );
  if (!res.SessionId) throw new AppError('AWS did not return a liveness session', 502);
  return res.SessionId;
}

export interface LivenessOutcome {
  /** AWS's own verdict for the session. */
  live: boolean;
  confidence: number;
  status: string;
  /** The frame AWS captured, which becomes the punch's selfie. */
  referenceImage: Buffer | null;
}

/**
 * How a check went.
 *
 * A session can only be read once it has completed, and each one is good for a
 * single punch — the caller must not reuse a session id, and the kiosk route
 * enforces that by consuming it.
 */
export async function livenessResult(sessionId: string): Promise<LivenessOutcome> {
  if (!isLivenessEnabled()) throw new AppError('Liveness checking is not configured', 503);

  const res = await rekognition().send(
    new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
  );
  const confidence = Math.round(res.Confidence ?? 0);
  const status = res.Status ?? 'UNKNOWN';
  const bytes = res.ReferenceImage?.Bytes;

  return {
    live: status === 'SUCCEEDED' && confidence >= env.KIOSK_LIVENESS_THRESHOLD,
    confidence,
    status,
    referenceImage: bytes ? Buffer.from(bytes) : null,
  };
}

export interface BrowserCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO timestamp; the tablet asks for a new set when this passes. */
  expiration: string;
  region: string;
}

/**
 * Short-lived credentials for the tablet, allowed to do one thing.
 *
 * Federated rather than the server's own keys: the policy below is intersected
 * with what the IAM user may do, so even a tablet that is carried out of the
 * building holds nothing but the ability to start a liveness stream, for
 * fifteen minutes.
 */
export async function browserCredentials(deviceName: string): Promise<BrowserCredentials> {
  if (!isLivenessEnabled()) throw new AppError('Liveness checking is not configured', 503);

  const sts = new STSClient({ region: livenessRegion(), credentials: credentials() });
  const res = await sts.send(
    new GetFederationTokenCommand({
      // Visible in CloudTrail, which is where you look when something is odd.
      Name: `kiosk-${deviceName.replace(/[^\w+=,.@-]/g, '-').slice(0, 20)}`,
      DurationSeconds: 900,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{ Effect: 'Allow', Action: ['rekognition:StartFaceLivenessSession'], Resource: '*' }],
      }),
    }),
  );

  const c = res.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken || !c.Expiration) {
    throw new AppError('AWS did not return usable credentials for the kiosk', 502);
  }
  return {
    accessKeyId: c.AccessKeyId,
    secretAccessKey: c.SecretAccessKey,
    sessionToken: c.SessionToken,
    expiration: c.Expiration.toISOString(),
    region: livenessRegion(),
  };
}
