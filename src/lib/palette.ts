/**
 * The site's colours, in one place. Tailwind reads the same values
 * (tailwind.config.js), and every canvas imports them from here, so the
 * charts can't drift from the page around them.
 *
 * Navy and gold are the house colours from the original kavascapital.com.
 */
export const C = {
    ink: '#080D19', // page ground
    deep: '#0C1324', // raised panels
    navy: '#14213D', // heritage navy, hairlines and fills
    ivory: '#ECE5D6', // primary text and the "market" series
    stone: '#A39C8C', // secondary text
    ash: '#6B675E', // tertiary text, axes
    gold: '#C8A96B', // the one accent
    goldLight: '#E3CB98',
    goldDeep: '#8E7547',
    slate: '#7F93B5', // cool secondary series
    sage: '#93A98C', // "spot" and positive marks
} as const;

/** `rgba()` from one of the hex colours above. */
export const rgba = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Hex as a number, for three.js. */
export const hexNum = (hex: string) => parseInt(hex.slice(1), 16);

export const MONO = '"JetBrains Mono", ui-monospace, monospace';
