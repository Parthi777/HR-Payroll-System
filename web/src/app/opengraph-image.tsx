import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

// Site-wide social preview, generated at build time from the unchanged lockup.
export const alt = 'Kayaazh Payroll — attendance, people and payroll for multi-branch dealerships.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage() {
  const svg = await readFile(path.join(process.cwd(), 'public/brand/payroll-light.svg'));
  const logo = `data:image/svg+xml;base64,${svg.toString('base64')}`;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#FFFFFF', padding: '64px 80px' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={444} height={128} alt="" style={{ marginLeft: -16 }} />
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 56, fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2, color: '#171C20' }}>
          <span>Attendance, people and payroll</span>
          <span style={{ color: '#00835E' }}>in one place.</span>
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 28, color: '#3A4249' }}>Selfie attendance · GPS geofencing · Payroll · WhatsApp</span>
          <div style={{ display: 'flex' }}>
            {['#00A174', '#F0B323'].map((c) => (
              <div key={c} style={{ width: 56, height: 10, background: c, marginLeft: 8, borderRadius: 5 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
