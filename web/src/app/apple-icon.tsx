import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ImageResponse } from 'next/og';

// iOS home-screen icon: the Payroll symbol on an opaque white square with clear
// space — the operating system applies its own corner mask (brand kit rule).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default async function AppleIcon() {
  const svg = await readFile(path.join(process.cwd(), 'public/brand/payroll-symbol.svg'));
  const symbol = `data:image/svg+xml;base64,${svg.toString('base64')}`;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#FFFFFF' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={symbol} width={124} height={124} alt="" />
      </div>
    ),
    size,
  );
}
