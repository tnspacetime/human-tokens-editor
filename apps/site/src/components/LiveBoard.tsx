import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { currentWindow, live, useLive } from "../lib/live";
import { QUALITIES } from "../lib/qualities";
import type { Board, BoardEntry, BoardWindow } from "../lib/types";
import { QualityIcon } from "./QualityIcon";
import { RollingNumber } from "./RollingNumber";

// The live board at the top of the feed: what came in and what readers made
// of it, over the last hour, 12 hours, day or week, with the top three
// pieces for each quality, which open out into the top ten. Scroll past it and it folds into the island.
export function LiveBoard({ board }: { board: Board }) {
	const state = useLive();
	const section = useRef<HTMLElement>(null);
	const [expanded, setExpanded] = useState(false);

	// Folding back up from far down the long lists: bring the board's top back
	// into view rather than leaving the reader somewhere below it.
	function toggle() {
		setExpanded(!expanded);
		const top = section.current?.getBoundingClientRect().top ?? 0;
		if (expanded && top < 0) section.current?.scrollIntoView({ behavior: "smooth", block: "start" });
	}

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
					<Stat value={shown.pieces} label={shown.pieces === 1 ? "post published" : "posts published"} />
				</dl>
				<BoardLists id="board-lists" period={shown} expanded={expanded} />
				<BoardToggle period={shown} expanded={expanded} onToggle={toggle} controls="board-lists" />
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

// Below the lists: the top three open out into the top ten, in place.
// Shown only when some list has more than three to show.
export function BoardToggle({
	period,
	expanded,
	onToggle,
	controls,
}: {
	period: BoardWindow;
	expanded: boolean;
	onToggle: () => void;
	controls: string;
}) {
	const more = QUALITIES.some((q) => period.top[q.id].length > 3);
	if (!more && !expanded) return null;
	return (
		<div className="board-more">
			<button type="button" className="board-toggle" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}>
				{expanded ? "Show the top 3" : "Show the top 10"}
				<svg viewBox="0 0 12 8" aria-hidden="true">
					<path d="M1.5 1.75 6 6.25l4.5-4.5" />
				</svg>
			</button>
		</div>
	);
}

// The top three for each quality, with a bar for each piece's share. When
// expanded, the rest of the top ten unfold beneath them: each list grows
// downward, its new rows falling into place one after another and their
// bars drawing out.
export function BoardLists({
	period,
	compact,
	expanded = false,
	id,
}: {
	period: BoardWindow;
	compact?: boolean;
	expanded?: boolean;
	id?: string;
}) {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const frame = requestAnimationFrame(() => setReady(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	return (
		<div id={id} className={compact ? "board-lists compact" : "board-lists"}>
			{QUALITIES.map((quality) => {
				const entries = period.top[quality.id];
				const most = entries[0]?.votes ?? 1;
				const row = (entry: BoardEntry, rank: number, shown: boolean, delay: number) => (
					<li key={entry.post.id} style={{ ["--rank" as string]: delay }}>
						<Link to="/p/$id/$slug" params={{ id: entry.post.id, slug: entry.post.slug }}>
							<span className="board-rank">{rank + 1}</span>
							<span className="board-entry">
								<span className="board-title">{entry.post.title}</span>
								<span className="board-meta">
									<span className="board-bar" style={{ ["--share" as string]: shown ? entry.votes / most : 0 }} />
									<span className="board-votes">{entry.votes}</span>
								</span>
							</span>
						</Link>
					</li>
				);
				const rest = entries.slice(3);
				return (
					<section key={quality.id} className="board-list" aria-label={`Most ${quality.label.toLowerCase()}`}>
						<h3>
							<QualityIcon name={quality.id} />
							{quality.label}
						</h3>
						{entries.length === 0 ? (
							<p className="board-empty">Nothing yet</p>
						) : (
							<ol>{entries.slice(0, 3).map((entry, rank) => row(entry, rank, ready, rank))}</ol>
						)}
						{rest.length > 0 && (
							<div className="board-extra" data-open={expanded || undefined} inert={!expanded}>
								<div className="board-extra-inner">
									<ol start={4}>
										{rest.map((entry, i) => row(entry, i + 3, ready && expanded, i))}
									</ol>
								</div>
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}
