'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';

/**
 * A plain photo from the tablet's front camera.
 *
 * The fallback for a deployment with no liveness configured. It proves nothing
 * about the person being present — a printed photograph passes — which is why
 * it is only reached when AWS liveness is switched off, and why the kiosk says
 * as much on screen.
 */
export function CameraCapture({
  onCapture,
  onError,
  busy,
}: {
  onCapture: (photo: Blob) => void;
  onError: (message: string) => void;
  busy: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'user', width: 720, height: 720 } })
      .then((s) => {
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => onError('The camera could not be opened. Check the tablet’s camera permission.'));

    // Let go of the camera when the screen changes — a tablet with a light
    // stuck on is a tablet somebody unplugs.
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, [onError]);

  const take = useCallback(() => {
    const el = video.current;
    if (!el) return;
    // A stream that has not produced a frame yet has no dimensions, and the
    // canvas drawn from it would be empty — which is what "the photo could not
    // be saved" looked like before the button waited for `loadedmetadata`.
    if (!el.videoWidth || !el.videoHeight) return onError('The camera is not ready yet — try again in a moment');
    const size = Math.min(el.videoWidth, el.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return onError('This browser cannot take a photo');
    ctx.drawImage(el, (el.videoWidth - size) / 2, (el.videoHeight - size) / 2, size, size, 0, 0, size, size);
    canvas.toBlob((blob) => (blob ? onCapture(blob) : onError('The photo could not be saved')), 'image/jpeg', 0.9);
  }, [onCapture, onError]);

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-square w-full max-w-md overflow-hidden rounded-3xl bg-slate-900">
        {/* Mirrored, because a tablet that shows you back-to-front is disorienting. */}
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          // Ready means the stream has real dimensions, not merely that it was
          // attached: the capture button is useless until then.
          onLoadedMetadata={() => setReady(true)}
          className="h-full w-full scale-x-[-1] object-cover"
        />
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80">
            <Loader2 className="h-4 w-4 animate-spin" /> Starting the camera…
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={take}
        disabled={!ready || busy}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl brand-gradient text-lg font-semibold text-white shadow-brand disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-6 w-6" />}
        {busy ? 'Marking…' : 'Take photo'}
      </button>
    </div>
  );
}
