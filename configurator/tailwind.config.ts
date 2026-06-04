import type { Config } from 'tailwindcss';

/**
 * Brand tokens lifted verbatim from the StormSafe Steel build brief (§4.1).
 * Use these classes (e.g. `bg-dark-2`, `text-teal`) instead of hardcoding hex.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        teal: { DEFAULT: '#22d3c8', dim: '#1ab5ab', glow: 'rgba(34,211,200,.10)' },
        dark: { DEFAULT: '#08121d', 2: '#111827', 3: '#1a2436', 4: '#1f2d42' },
        border: { DEFAULT: '#1e2d42', vis: '#2a3d55' },
        text: { DEFAULT: '#e2e8f0' },
        sub: '#94a3b8',
        muted: '#64748b',
        danger: '#f87171',
        warning: '#fbbf24',
        success: '#34d399',
      },
      fontFamily: {
        head: ['Orbitron', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      letterSpacing: { brand: '.04em', wide2: '.08em' },
    },
  },
  plugins: [],
} satisfies Config;
