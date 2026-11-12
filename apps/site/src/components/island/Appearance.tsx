import { useEffect, useState } from "react";
import { THEME_COOKIE, THEMES, type Theme } from "../../lib/theme";
import { Slot } from "./Slot";

const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

function apply(theme: Theme) {
	const root = document.documentElement;
	if (theme === "system") delete root.dataset.theme;
	else root.dataset.theme = theme;
}

// The half-filled circle, and System · Light · Dark when it's open. The
// choice is kept in a cookie so the server renders it with no flash; the
// colours fade across.
export function Appearance({
	initial,
	open,
	onToggle,
	onClose,
}: {
	initial: Theme;
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
}) {
	const [theme, setTheme] = useState(initial);
	useEffect(() => setTheme(initial), [initial]);

	function choose(next: Theme) {
		onClose();
		if (next === theme) return;
		document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
		setTheme(next);
		const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduce || !document.startViewTransition) apply(next);
		else document.startViewTransition(() => apply(next));
	}

	return (
		<>
			<button
				type="button"
				className="island-glyph"
				aria-expanded={open}
				aria-controls="island-appearance"
				aria-label="Appearance"
				onClick={onToggle}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.25" />
					<path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
				</svg>
			</button>
			<Slot open={open}>
				<div id="island-appearance" className="island-choices" role="radiogroup" aria-label="Appearance">
					{THEMES.map((value) => (
						<button key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => choose(value)}>
							{LABELS[value]}
						</button>
					))}
				</div>
			</Slot>
		</>
	);
}
