'use client';

import { CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
import BranchMap from '@/components/branch-map';
import type { TrackBranch, TrackedEmployee, TrackState } from '@/hooks/useApi';

/** Dot colour per state: green inside, red away, grey when the phone is silent. */
export const STATE_COLOR: Record<TrackState, string> = {
  INSIDE: '#16a34a',
  OUTSIDE: '#e11d48',
  OFF: '#64748b',
  NO_SIGNAL: '#94a3b8',
};

export const STATE_LABEL: Record<TrackState, string> = {
  INSIDE: 'Inside',
  OUTSIDE: 'Away',
  OFF: 'GPS off',
  NO_SIGNAL: 'No signal',
};

export interface TrackPoint {
  ts: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  status: string | null;
  distance: number | null;
  mock: boolean;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/**
 * Branch fences plus one dot per tracked employee at their last fix, and — for
 * the selected one — the day's path, red where it left the fence.
 */
export default function LiveTrackingMap({
  branches,
  employees,
  selected,
  path,
  onSelect,
  height = 440,
}: {
  branches: TrackBranch[];
  employees: TrackedEmployee[];
  selected: string | null;
  path: TrackPoint[];
  onSelect: (attendanceId: string) => void;
  height?: number;
}) {
  // Consecutive fixes in the same state make one stroke, so the path reads as
  // green stretches and red stretches rather than hundreds of tiny segments.
  const strokes: { away: boolean; points: [number, number][] }[] = [];
  for (const p of path) {
    const away = p.status === 'OUTSIDE';
    const last = strokes[strokes.length - 1];
    const pt: [number, number] = [p.lat, p.lng];
    if (last && last.away === away) last.points.push(pt);
    else strokes.push({ away, points: last ? [last.points[last.points.length - 1], pt] : [pt] });
  }

  return (
    <BranchMap branches={branches} height={height} scrollZoom>
      {strokes.map((s, i) => (
        <Polyline key={i} positions={s.points} pathOptions={{ color: s.away ? '#e11d48' : '#00835E', weight: 4, opacity: 0.8 }} />
      ))}
      {path.length > 0 && (
        <CircleMarker center={[path[0].lat, path[0].lng]} radius={5} pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#171C20', fillOpacity: 1 }}>
          <Tooltip>First fix · {time(path[0].ts)}</Tooltip>
        </CircleMarker>
      )}
      {employees
        .filter((e) => e.last)
        .map((e) => {
          const color = STATE_COLOR[e.state];
          const isSel = e.attendanceId === selected;
          return (
            <CircleMarker
              key={e.attendanceId}
              center={[e.last!.lat, e.last!.lng]}
              radius={isSel ? 10 : 8}
              pathOptions={{ color: '#ffffff', weight: isSel ? 3 : 2, fillColor: color, fillOpacity: 1 }}
              eventHandlers={{ click: () => onSelect(e.attendanceId) }}
            >
              <Tooltip direction="top" offset={[0, -8]}>{e.name}</Tooltip>
              <Popup>
                <strong>{e.name}</strong> <span style={{ color: '#64748b' }}>{e.employeeCode}</span>
                <br />
                {STATE_LABEL[e.state]} · {e.branch}
                <br />
                Last seen {time(e.last!.ts)}
                {e.last!.distance != null && <> · {Math.round(e.last!.distance)} m from centre</>}
                {e.last!.accuracy != null && <> · ±{Math.round(e.last!.accuracy)} m</>}
              </Popup>
            </CircleMarker>
          );
        })}
    </BranchMap>
  );
}
