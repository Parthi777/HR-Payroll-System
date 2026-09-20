'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Amplify } from 'aws-amplify';
import { Loader2 } from 'lucide-react';
import { kioskApi, type LivenessStart } from '@/lib/kiosk-api';
import '@aws-amplify/ui-react/styles.css';

/**
 * The live-person check, run by AWS in the tablet's own browser.
 *
 * Loaded only when it is needed, and never on the server: the component opens a
 * camera and a WebSocket to AWS, neither of which exists during server
 * rendering, and it is the single largest thing this app would otherwise ship
 * to every page.
 */
const FaceLivenessDetector = dynamic(
  () => import('@aws-amplify/ui-react-liveness').then((m) => m.FaceLivenessDetector),
  { ssr: false, loading: () => <Waiting label="Starting the camera…" /> },
);

function Waiting({ label }: { label: string }) {
  return (
    <div className="flex h-[26rem] items-center justify-center gap-2 rounded-2xl bg-muted/50 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

/**
 * Runs one check and hands back its session id, which the punch then presents.
 *
 * The result is never decided here: this component only reports that the check
 * finished. Whether it passed is read from AWS by the server, because a browser
 * saying "I passed" is exactly what the check exists to disbelieve.
 */
export function LivenessCheck({
  onFinished,
  onCancel,
  onError,
}: {
  onFinished: (sessionId: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [start, setStart] = useState<LivenessStart | null>(null);

  useEffect(() => {
    let live = true;
    kioskApi
      .post<LivenessStart>('/liveness/session')
      .then((res) => {
        if (!live) return;
        // Short-lived credentials, allowed to do one thing, handed straight to
        // Amplify. Nothing is stored: a new set comes with the next check.
        Amplify.configure(
          { Auth: { Cognito: { identityPoolId: '', allowGuestAccess: true, userPoolId: '', userPoolClientId: '' } } },
          {
            Auth: {
              credentialsProvider: {
                getCredentialsAndIdentityId: async () => ({
                  credentials: {
                    accessKeyId: res.credentials.accessKeyId,
                    secretAccessKey: res.credentials.secretAccessKey,
                    sessionToken: res.credentials.sessionToken,
                    expiration: new Date(res.credentials.expiration),
                  },
                }),
                clearCredentialsAndIdentityId: () => {},
              },
            },
          },
        );
        setStart(res);
      })
      .catch((err) => onError(err instanceof Error ? err.message : 'Could not start the camera check'));
    return () => { live = false; };
  }, [onError]);

  if (!start) return <Waiting label="Preparing the camera check…" />;

  return (
    <div className="overflow-hidden rounded-2xl">
      <FaceLivenessDetector
        sessionId={start.sessionId}
        region={start.credentials.region}
        onAnalysisComplete={async () => onFinished(start.sessionId)}
        onUserCancel={onCancel}
        onError={(err) => onError(err.state ? `Camera check failed (${err.state})` : 'Camera check failed')}
        disableStartScreen
      />
    </div>
  );
}
