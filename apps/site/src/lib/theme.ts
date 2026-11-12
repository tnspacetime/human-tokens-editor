// The reader's choice of look. "system" follows the device. It's kept in a
// cookie (not just localStorage) so the server renders the right theme
// straight away: no flash of the wrong colours on load, even without JS.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "ht_theme";

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);
