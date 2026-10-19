import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '2rem', screens: { '2xl': '1400px' } },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        /*
         * Kayaazh Payroll green. 500 is the exact brand colour (#00A174) — the
         * logo, highlights, focus. Anything carrying white text uses 600 or
         * darker: white on #00A174 is only 3.3:1, on #00835E it is 4.6:1.
         */
        brand: {
          DEFAULT: '#00835E',
          50: '#E8F7F2',
          100: '#D0EFE5',
          200: '#A3DFCB',
          300: '#66C9A8',
          400: '#2FB58A',
          500: '#00A174',
          600: '#00835E',
          700: '#006A4C',
          800: '#00523B',
          900: '#0B3D2E',
        },
        /* Brand yellow — an accent only, never behind white text. */
        gold: {
          DEFAULT: '#F0B323',
          50: '#FEF7E6',
          100: '#FCEBC2',
          500: '#F0B323',
          600: '#C98F0B',
          700: '#9A6C06',
        },
        /* Brand charcoal: ink, and the reversed-logo surfaces. */
        ink: {
          DEFAULT: '#171C20',
          900: '#171C20',
          950: '#11161D',
        },
      },
      borderRadius: {
        '2xl': 'calc(var(--radius) + 4px)',
        xl: 'var(--radius)',
        lg: 'calc(var(--radius) - 4px)',
        md: 'calc(var(--radius) - 6px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      boxShadow: {
        soft: '0 8px 30px -12px rgba(0,131,94,0.22)',
        brand: '0 12px 32px -8px rgba(0,131,94,0.40)',
      },
      /*
       * Ambient motion for the brand surfaces.
       *
       * tailwindcss-animate covers entrances (`animate-in`, `fade-in`,
       * `slide-in-from-*`), which is most of what the marketing surfaces need.
       * These are the things it deliberately does not do: slow loops that keep
       * a gradient panel from looking like a screenshot.
       *
       * All are long and low-amplitude on purpose. A login screen is somewhere
       * people go every morning, and motion that is noticeable on the first
       * visit is irritating by the fiftieth. Every one of them is switched off
       * under prefers-reduced-motion — see globals.css.
       */
      /* `rise-in` is NOT here — it lives in globals.css. Tailwind only emits a
       * keyframe when a matching `animate-*` utility appears in the source, and
       * the staggered entrances set `animation` inline with a computed delay, so
       * no such class is ever written and the JIT tree-shook the keyframe away.
       * The animation then referenced a name the stylesheet did not define and
       * silently did nothing. These four are used as real utility classes. */
      keyframes: {
        /* Light sources drifting behind the panel. */
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '33%': { transform: 'translate3d(3%, -4%, 0) scale(1.08)' },
          '66%': { transform: 'translate3d(-3%, 3%, 0) scale(0.96)' },
        },
        /* A highlight travelling once across a surface. */
        sheen: {
          '0%': { transform: 'translateX(-120%)' },
          '100%': { transform: 'translateX(220%)' },
        },
        /* Breathing ring behind the logo mark. */
        halo: {
          '0%, 100%': { opacity: '0.35', transform: 'scale(1)' },
          '50%': { opacity: '0.6', transform: 'scale(1.12)' },
        },
      },
      animation: {
        drift: 'drift 22s ease-in-out infinite',
        'drift-slow': 'drift 30s ease-in-out infinite reverse',
        sheen: 'sheen 6s ease-in-out infinite',
        halo: 'halo 5s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
