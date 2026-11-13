import { useEffect, useState } from "react";

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Digits that roll to their value like a departure board, from zero when
// the board first appears and from the old value when the window changes.
export function RollingNumber({ value }: { value: number }) {
	const [shown, setShown] = useState(0);
	useEffect(() => {
		const frame = requestAnimationFrame(() => setShown(value));
		return () => cancelAnimationFrame(frame);
	}, [value]);
	const width = Math.max(String(value).length, String(shown).length);
	const digits = String(shown).padStart(width, "0").split("").map(Number);
	const target = String(value).padStart(width, "0");
	return (
		<span className="rolling" aria-label={String(value)}>
			{digits.map((digit, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: digit positions
					key={i}
					className="rolling-digit"
					aria-hidden="true"
					data-lead={target.slice(0, i + 1).match(/^0+$/) && i < width - 1 ? "" : undefined}
					style={{ ["--d" as string]: digit, ["--pos" as string]: width - i }}
				>
					<span className="rolling-strip">
						{DIGITS.map((d) => (
							<span key={d}>{d}</span>
						))}
					</span>
				</span>
			))}
		</span>
	);
}
