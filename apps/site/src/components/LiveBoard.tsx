import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { currentWindow, live, useLive } from "../lib/live";
import { QUALITIES } from "../lib/qualities";
import type { Board, BoardWindow } from "../lib/types";
import { QualityIcon } from "./QualityIcon";

// The live board at the top of the feed: what came in and what readers made
// of it, over the last hour, 12 hours, day or week, with the top three
// pieces for each quality. Scroll past it and it folds into the island.
export function LiveBoard({ board }: { board: Board }) {
	const state = useLive();
	const section = useRef<HTMLElement>(null);

	// Hand the board to the island; take it back when leaving the feed.
	useEffect(() => {
		live.set({ board, window: live.get().board ? live.get().window : board.initial });
		return () => live.set({ board: null, docked: false, sheet: false });
	}, [board]);

	// Docked once the board has gone up under the island.
	useEffect(() => {
		const element = section.current;
		if (!element) return;
		const observer = new IntersectionObserver(
			([entry]) => {
				const docked = !entry.isIntersecting && entry.boundingClientRect.top < 0;
				if (docked !== live.get().docked) live.set({ docked, ...(docked ? {} : { sheet: false }) });
			},
			{ rootMargin: "-72px 0px 0px 0px", threshold: 0 },
		);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const shown = currentWindow(state) ?? board.windows.find((w) => w.id === board.initial) ?? board.windows[0];
	return (
		<section ref={section} className="live" aria-labelledby="live-title">
			<header className="section-head">
				<h2 id="live-title">
					<span className="live-dot" aria-hidden="true" />
					Live
				</h2>
				<WindowSwitch board={board} selected={shown.id} />
			</header>
			<div className="live-panel">
				<dl className="live-stats">
					<Stat value={shown.reactions} label={shown.reactions === 1 ? "reaction" : "reactions"} />
					<Stat value={shown.readers} label={shown.readers === 1 ? "reader reacting" : "readers reacting"} />
					<Stat value={shown.pieces} label={shown.pieces === 1 ? "piece published" : "pieces published"} />
				</dl>
				<BoardLists period={shown} />
			</div>
		</section>
	);
}

export function WindowSwitch({ board, selected }: { board: Board; selected: BoardWindow["id"] }) {
	const index = board.windows.findIndex((w) => w.id === selected);
	return (
		<div className="window-switch" role="radiogroup" aria-label="Time window" style={{ ["--at" as string]: index }}>
			<span className="window-thumb" aria-hidden="true" />
			{board.windows.map((w) => (
				<button
					key={w.id}
					type="button"
					role="radio"
					aria-checked={w.id === selected}
					aria-label={w.label}
					onClick={() => live.set({ window: w.id })}
				>
					{w.id}
				</button>
			))}
		</div>
	);
}

function Stat({ value, label }: { value: number; label: string }) {
	return (
		<div className="stat">
			<dt>{label}</dt>
			<dd>
				<RollingNumber value={value} />
			</dd>
		</div>
	);
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

// Digits that roll to their value like a departure board, from zero when
// the board first appears and from the old value when the window changes.
function RollingNumber({ value }: { value: number }) {
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

// The top three for each quality, with a bar for each piece's share.
export function BoardLists({ period, compact }: { period: BoardWindow; compact?: boolean }) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const frame = requestAnimationFrame(() => setReady(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<div className={compact ? "board-lists compact" : "board-lists"}>
			{QUALITIES.map((quality) => {
				const entries = period.top[quality.id];
				const most = entries[0]?.votes ?? 1;
				return (
					<section key={quality.id} className="board-list" aria-label={`Most ${quality.label.toLowerCase()}`}>
						<h3>
							<QualityIcon name={quality.id} />
							{quality.label}
						</h3>
						{entries.length === 0 ? (
							<p className="board-empty">No one yet</p>
						) : (
							<ol>
								{entries.map((entry, rank) => (
									<li key={entry.post.id} style={{ ["--rank" as string]: rank }}>
										<Link to="/p/$id/$slug" params={{ id: entry.post.id, slug: entry.post.slug }}>
											<span className="board-rank">{rank + 1}</span>
											<span className="board-entry">
												<span className="board-title">{entry.post.title}</span>
												<span className="board-meta">
													<span className="board-bar" style={{ ["--share" as string]: ready ? entry.votes / most : 0 }} />
													<span className="board-votes">{entry.votes}</span>
												</span>
											</span>
										</Link>
									</li>
								))}
							</ol>
						)}
					</section>
				);
			})}
		</div>
	);
}
