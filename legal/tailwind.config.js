import animate from 'tailwindcss-animate';
import plugin from 'tailwindcss/plugin';
import colors from 'tailwindcss/colors';

// ── Day / night colour ramps ─────────────────────────────────────────────────
// The app was built dark-only, with ~2600 call sites on fixed hex ramps
// (`bg-dark-800`, `border-primary-500/40`, `text-gray-500`, `text-white`,
// `text-success-400` ...). Rather than touch every call site, each ramp step is
// a CSS variable holding space-separated RGB channels, so `/alpha` modifiers
// keep working and the whole ramp flips with the `.dark` class.
//
// NIGHT is the original palette, unchanged. DAY is a mirror of it: the step a
// call site picked for "a bit lighter than the ground" on black becomes "a bit
// darker than the ground" on white. Neutral ramps are hand-tuned so surfaces
// stay quiet on white; the vivid scales are mirrored step-for-step (400 <-> 600,
// 900 <-> 100), which keeps every hue — so green/red/amber still carry P&L and
// trigger state — while moving text to a shade that reads on a light ground.
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const mirror = (ramp) =>
  Object.fromEntries(STEPS.map((step, i) => [step, ramp[STEPS[STEPS.length - 1 - i]]]));
const channels = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
};

const NIGHT = {
  // Page/surface ramp. Tailwind `neutral` plus 750/850 half-steps.
  dark: {
    50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3',
    500: '#737373', 600: '#525252', 700: '#404040', 750: '#333333', 800: '#262626',
    850: '#1f1f1f', 900: '#171717', 950: '#0a0a0a',
  },
  // Emphasis ramp for a near-black base: Tailwind `neutral` shifted two steps
  // lighter, so text-primary-400 / border-primary-500 still read as highlights.
  // Solid fills use `bg-primary text-primary-foreground`.
  primary: {
    50: '#ffffff', 100: '#fafafa', 200: '#f5f5f5', 300: '#e5e5e5', 400: '#d4d4d4',
    500: '#a3a3a3', 600: '#737373', 700: '#525252', 800: '#404040', 900: '#262626',
    950: '#171717',
  },
  gray: colors.gray,
  success: colors.green,
  danger: colors.red,
  warning: colors.amber,
  emerald: colors.emerald,
  red: colors.red,
  amber: colors.amber,
  orange: colors.orange,
  sky: colors.sky,
  purple: colors.purple,
  violet: colors.violet,
};

const DAY = {
  ...Object.fromEntries(Object.entries(NIGHT).map(([name, ramp]) => [name, mirror(ramp)])),
  dark: {
    50: '#171717', 100: '#262626', 200: '#404040', 300: '#525252', 400: '#737373',
    500: '#a3a3a3', 600: '#c4c4c4', 700: '#d9d9d9', 750: '#e3e3e3', 800: '#ececec',
    850: '#f4f4f4', 900: '#fafafa', 950: '#ffffff',
  },
  primary: {
    50: '#0a0a0a', 100: '#171717', 200: '#262626', 300: '#404040', 400: '#525252',
    500: '#737373', 600: '#a3a3a3', 700: '#d4d4d4', 800: '#e5e5e5', 900: '#f0f0f0',
    950: '#f7f7f7',
  },
};

const THEME_VARS = { light: {}, dark: {} };
for (const [mode, palette] of [['light', DAY], ['dark', NIGHT]]) {
  for (const [name, ramp] of Object.entries(palette)) {
    for (const [step, hex] of Object.entries(ramp)) {
      THEME_VARS[mode][`--c-${name}-${step}`] = channels(hex);
    }
  }
  // `text-white` / `border-white/5` mean "ink" and "hairline" on a black
  // ground, so on a white ground they become near-black. `black` is NOT
  // flipped: its one job is the modal scrim, which dims in both themes.
  THEME_VARS[mode]['--c-white'] = mode === 'dark' ? '255 255 255' : '10 10 10';
  THEME_VARS[mode]['--c-black'] = '0 0 0';
}

function themedScale(name) {
  return Object.fromEntries(
    Object.keys(NIGHT[name]).map((step) => [step, `rgb(var(--c-${name}-${step}) / <alpha-value>)`]),
  );
}

const THEMED_COLORS = {
  ...Object.fromEntries(
    Object.keys(NIGHT)
      .filter((name) => !['primary', 'success', 'danger', 'warning'].includes(name))
      .map((name) => [name, themedScale(name)]),
  ),
  white: 'rgb(var(--c-white) / <alpha-value>)',
  black: 'rgb(var(--c-black) / <alpha-value>)',
};

/** @type {import('tailwindcss').Config} */
export default {
  // shadcn/ui themes through a `.dark` class on <html>. Night (dark) is the
  // default; the Sun/Moon toggle in the header switches to day (light). The
  // class is set before first paint by the inline script in index.html and
  // kept in sync by src/stores/themeStore.ts.
  darkMode: ['class'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- shadcn/ui semantic tokens ---------------------------------
        // Driven by the CSS variables in src/index.css, which are set to the
        // brand scales below so the two systems render identically.
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          // Numbered emphasis ramp: see THEMED below.
          ...themedScale('primary'),
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // --- domain colours --------------------------------------------
        // P&L and trigger state read as green/red/amber across the app; these
        // are semantic in the trading sense, so they stay as explicit scales
        // rather than collapsing into shadcn's single `destructive`.
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          ...themedScale('success'),
        },
        danger: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          ...themedScale('danger'),
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          ...themedScale('warning'),
        },
        // --- categorical accents ------------------------------------------
        // A closed, evenly-spaced ramp driven by --cat-N in index.css. Use it
        // to keep CATEGORIES apart (leg types, pair 1/2/3, cadence tags, chart
        // series). It is not a palette of accent colours: chrome stays neutral.
        // Deliberately avoids the red/amber and green bands, which carry P&L.
        cat: {
          1: 'hsl(var(--cat-1) / <alpha-value>)',
          2: 'hsl(var(--cat-2) / <alpha-value>)',
          3: 'hsl(var(--cat-3) / <alpha-value>)',
          4: 'hsl(var(--cat-4) / <alpha-value>)',
          5: 'hsl(var(--cat-5) / <alpha-value>)',
          6: 'hsl(var(--cat-6) / <alpha-value>)',
          7: 'hsl(var(--cat-7) / <alpha-value>)',
        },
        // `dark-*`, the numbered `primary-*`, `gray`, `white`/`black` and the
        // vivid scales are spread in below from THEMED, so they flip with the
        // `.dark` class instead of being baked-in hex.
        ...THEMED_COLORS,
      },
      // Tailwind's built-in default ring colour is blue-500; point it at the
      // token so a bare `ring-2` can never reintroduce blue.
      ringColor: {
        DEFAULT: 'hsl(var(--ring))',
      },
      // Nimai is squared-off: the POS draws panels, cards and inputs with no
      // radius at all, and the Tasks port settled on 3px. Every Tailwind step
      // collapses onto 2-3px so the ~600 existing `rounded-*` call sites land
      // in the language without being edited. `rounded-full` still means pill.
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '2px',
        md: '2px',
        lg: 'var(--radius)',
        xl: 'var(--radius)',
        '2xl': 'var(--radius)',
        '3xl': 'var(--radius)',
        full: '9999px',
      },
      // ── Type scale ──────────────────────────────────────────────────
      // The VALUES live in src/index.css as `--t-*`, so this ramp and the
      // `.tk-*` stylesheet in components/tasks/tasks.css cannot fork. Read the
      // comment there before changing a size.
      //
      // Named by ROLE, not by t-shirt size. The t-shirt names below are kept
      // as ALIASES onto ramp steps so a stray `text-sm` still lands on the ramp
      // instead of off it. Since the 2026-09-03 shift `text-sm` is 14px, which
      // happens to match stock Tailwind — a coincidence, not a contract. The
      // alias follows `--t-body` wherever it goes.
      //
      // `display-sm` (1.2rem) is GONE. It sat 1.2px from `title` — two
      // spellings of one size, which is the drift the POS comment forbids. Its
      // call sites were all metric values and moved onto the metric ladder:
      //   HERO    text-display font-mono font-bold      the figure a panel exists to show
      //   CARD    text-title   font-mono font-semibold  a header chip, a paired value
      //   INLINE  text-body    font-mono font-semibold  a figure in a table row
      //
      // `lead` is GONE too, for the same reason: the 1px shift made it 14px,
      // the same as `body`. It had no call sites and no alias, so it went
      // rather than becoming a second spelling of the body size.
      //
      // Plain strings on purpose: font-size only, no line-height, so a step
      // never silently re-leads a dense table row.
      fontSize: {
        micro: 'var(--t-micro)',        // 11px — the label band
        eyebrow: 'var(--t-eyebrow)',    // 12px — the band on a control
        meta: 'var(--t-meta)',          // 13px — timestamps, secondary facts
        body: 'var(--t-body)',          // 14px — default UI text
        subhead: 'var(--t-subhead)',    // 16px — section subheads
        title: 'var(--t-title)',        // 18px — panel titles, card metrics
        display: 'var(--t-display)',    // 1.5rem — page head, hero metrics
        'display-lg': 'var(--t-display-lg)',

        xs: 'var(--t-meta)',
        sm: 'var(--t-body)',
        base: 'var(--t-subhead)',
        lg: 'var(--t-title)',
        xl: 'var(--t-display)',
        '2xl': 'var(--t-display)',
        '3xl': 'var(--t-display-lg)',
        '4xl': 'var(--t-display-lg)',
      },
      // Nimai's tracked-uppercase band. Tailwind's widest is 0.1em; the POS
      // labels sit at 0.14-0.2em, which is what makes them read as Nimai.
      letterSpacing: {
        tighter: '-0.05em',
        tight: '-0.025em',
        normal: '0',
        wide: 'var(--tr-wide)',
        wider: 'var(--tr-wider)',
        widest: 'var(--tr-widest)',
        eyebrow: 'var(--tr-eyebrow)',
        brand: 'var(--tr-brand)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        // Price tick flash (TickFlash): background lights green/red, fades out.
        'tick-up': {
          '0%': { backgroundColor: 'hsl(var(--success) / 0.45)' },
          '100%': { backgroundColor: 'transparent' },
        },
        'tick-down': {
          '0%': { backgroundColor: 'hsl(var(--danger) / 0.45)' },
          '100%': { backgroundColor: 'transparent' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-light': 'bounce 1s infinite',
        'tick-up': 'tick-up 0.8s ease-out',
        'tick-down': 'tick-down 0.8s ease-out',
      },
    },
  },
  plugins: [
    animate,
    // Emits the --c-* channel variables behind THEMED_COLORS: day values on
    // :root, night values on .dark.
    plugin(({ addBase }) => addBase({ ':root': THEME_VARS.light, '.dark': THEME_VARS.dark })),
  ],
}
