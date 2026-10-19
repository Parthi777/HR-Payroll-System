/**
 * The Kayaazh marks, from the brand kit (public/brand/*.svg — vector masters,
 * lettering outlined, so no font is needed).
 *
 *   product  payroll → this product, Kayaazh Payroll
 *            parent  → Kayaazh itself, for the platform console behind it
 *   variant  lockup  → symbol + wordmark; symbol → the mark alone
 *   tone     light   → for white / pale surfaces; dark → reversed, for charcoal
 *
 * Brand rules this follows: the symbol alone wherever a lockup would be
 * narrower than 240px (140px for the parent), the coloured marks only on white
 * or charcoal — never on a green gradient — and nothing restyled: no shadow,
 * stretch or recolour. The `height` sets the size; the width follows the
 * artwork's own proportions.
 */
type Product = 'payroll' | 'parent';

const FILES: Record<Product, { lockup: { light: string; dark: string }; symbol: { light: string; dark: string }; label: string }> = {
  payroll: {
    lockup: { light: '/brand/payroll-light.svg', dark: '/brand/payroll-dark.svg' },
    // Green and yellow read on both white and charcoal, so one file serves both.
    symbol: { light: '/brand/payroll-symbol.svg', dark: '/brand/payroll-symbol.svg' },
    label: 'Kayaazh Payroll',
  },
  parent: {
    lockup: { light: '/brand/kayaazh-light.svg', dark: '/brand/kayaazh-dark.svg' },
    // The parent mark is charcoal; reversed, it is white.
    symbol: { light: '/brand/kayaazh-symbol.svg', dark: '/brand/kayaazh-symbol-white.svg' },
    label: 'Kayaazh',
  },
};

/** Intrinsic artwork sizes (viewBox), so the browser reserves the right box before load. */
const RATIO: Record<Product, number> = { payroll: 740 / 214, parent: 700 / 180 };

export function BrandLogo({
  product = 'payroll',
  variant = 'lockup',
  tone = 'light',
  height,
  className,
}: {
  product?: Product;
  variant?: 'lockup' | 'symbol';
  tone?: 'light' | 'dark';
  height: number;
  className?: string;
}) {
  const f = FILES[product];
  const src = variant === 'symbol' ? f.symbol[tone] : f.lockup[tone];
  const width = Math.round(variant === 'symbol' ? height : height * RATIO[product]);
  return (
    // Static SVGs from /public: next/image adds nothing for a vector and would
    // need `dangerouslyAllowSVG`.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={f.label} width={width} height={height} className={className} draggable={false} />
  );
}
