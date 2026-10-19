import defaultTheme from 'tailwindcss/defaultTheme';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Same values as src/lib/palette.ts.
      colors: {
        ink: '#080D19',
        deep: '#0C1324',
        navy: '#14213D',
        ivory: '#ECE5D6',
        stone: '#A39C8C',
        ash: '#6B675E',
        gold: { DEFAULT: '#C8A96B', light: '#E3CB98', deep: '#8E7547' },
        rule: 'rgba(236,229,214,0.09)',
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        serif: ['"Cormorant Garamond"', ...defaultTheme.fontFamily.serif],
        mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono],
      },
      letterSpacing: {
        eyebrow: '0.28em',
      },
    },
  },
  plugins: [],
};
