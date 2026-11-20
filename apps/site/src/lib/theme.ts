// The reader's choice of look. "system" follows the device. It's kept in a
// cookie, and THEME_SCRIPT, at the top of every page, puts it on <html>
// before anything is drawn: no flash of the wrong colours. (Pages are the
// same for everyone, so the server never reads it.)
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "ht_theme";

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

/** Your theme from the cookie, or "system" (in the browser only). */
export function savedTheme(): Theme {
	const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([a-z]+)`));
	return match && isTheme(match[1]) ? match[1] : "system";
}

/** Runs first thing in <head>: light or dark from the cookie onto <html>. */
export const THEME_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);if(m)document.documentElement.dataset.theme=m[1]}catch(e){}`;
