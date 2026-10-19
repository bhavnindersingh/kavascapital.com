import { create } from 'zustand';

/**
 * Day / night theme for the whole app.
 *
 * NIGHT (dark) is the default. The choice is kept in localStorage under
 * `theme` and applied as the `dark` class on <html>; index.html applies the
 * same key before first paint so a reload never flashes the wrong theme.
 * Every colour in the app reads CSS variables that flip with that class (see
 * tailwind.config.js and src/index.css). Canvas charts can't read `var()`, so
 * they subscribe to `theme` and pull resolved values from `chartTheme()`.
 */
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'theme';
// Matches --background in src/index.css, for the mobile browser chrome.
const META_COLOUR: Record<Theme, string> = { dark: '#0a0a0a', light: '#ffffff' };

function readStored(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOUR[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* private mode: the toggle still works for this tab */
  }
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readStored(),
  setTheme: (theme) => {
    apply(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

/** The current theme; components that draw with resolved colours re-render on change. */
export const useTheme = () => useThemeStore((s) => s.theme);

/**
 * Resolved neutral colours for canvas/SVG charts (chart.js, lightweight-charts,
 * Plotly), which cannot read CSS variables. Call during render after
 * `useTheme()` so the values follow the toggle. Series colours (P&L green/red,
 * categorical hues) work on both grounds and stay where they are.
 */
export function chartTheme(theme: Theme) {
  const night = theme === 'dark';
  return {
    /** page / plot background */
    bg: night ? '#0a0a0a' : '#ffffff',
    /** primary ink: titles, tooltip body, emphasised labels */
    text: night ? '#fafafa' : '#0a0a0a',
    /** secondary ink: axis ticks, legends, tooltip titles */
    muted: night ? '#a3a3a3' : '#525252',
    /** tertiary ink: axis titles, de-emphasised ticks */
    subtle: night ? '#737373' : '#737373',
    /** chart frame / scale borders */
    border: night ? '#404040' : '#d4d4d4',
    /** zero lines and other strong reference lines */
    zero: night ? '#525252' : '#a3a3a3',
    /** gridlines, at the given alpha */
    grid: (alpha = 0.35) => (night ? `rgba(64, 64, 64, ${alpha})` : `rgba(163, 163, 163, ${alpha})`),
    /** reference-line neutral, at the given alpha */
    ref: (alpha = 0.5) => (night ? `rgba(163, 163, 163, ${alpha})` : `rgba(82, 82, 82, ${alpha})`),
    /** tooltip / floating label fill */
    tooltipBg: night ? 'rgba(10, 10, 10, 0.95)' : 'rgba(255, 255, 255, 0.97)',
    /** chip fill behind an inline chart label */
    chipBg: night ? 'rgba(82, 82, 82, 0.85)' : 'rgba(229, 229, 229, 0.9)',
  };
}
export type ChartTheme = ReturnType<typeof chartTheme>;
