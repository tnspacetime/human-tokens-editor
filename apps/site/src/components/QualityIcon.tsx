import type { Quality } from "../lib/qualities";

// One small line icon per quality, drawn on a 16-point grid like SF Symbols:
// Novel a spark, Fresh a leaf, Clear a drop of water, Moving a heart.
const PATHS: Record<Quality | "comments", string> = {
	novel: "M8 1.75C8.45 5.3 10.7 7.55 14.25 8 10.7 8.45 8.45 10.7 8 14.25 7.55 10.7 5.3 8.45 1.75 8 5.3 7.55 7.55 5.3 8 1.75Z",
	fresh: "M3 13C3 7 6.6 3 13 3c0 6.4-4 10-10 10ZM3 13l5.5-5.5",
	clear: "M8 2.2c2.5 3 4.4 5.4 4.4 7.6a4.4 4.4 0 0 1-8.8 0C3.6 7.6 5.5 5.2 8 2.2Z",
	moving: "M8 13.4S2.4 10.1 2.4 6.2A2.9 2.9 0 0 1 8 4.7a2.9 2.9 0 0 1 5.6 1.5c0 3.9-5.6 7.2-5.6 7.2Z",
	comments:
		"M2.5 7.6c0-2.75 2.45-4.85 5.5-4.85s5.5 2.1 5.5 4.85S11.05 12.45 8 12.45c-.66 0-1.3-.1-1.88-.28L3.1 13.25l.66-2.35A4.5 4.5 0 0 1 2.5 7.6Z",
};

export function QualityIcon({ name, className }: { name: Quality | "comments"; className?: string }) {
	return (
		<svg className={className ?? "q-icon"} viewBox="0 0 16 16" aria-hidden="true">
			<path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
		</svg>
	);
}
