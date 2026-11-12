import { useEffect, useState } from "react";
import { QUALITIES } from "../../lib/qualities";
import type { Board, BoardWindow } from "../../lib/types";
import { BoardLists, WindowSwitch } from "../LiveBoard";
import { QualityIcon } from "../QualityIcon";
import { Slot } from "./Slot";

const TICK_MS = 3200;

// The live board, carried by the island once it has scrolled off the feed:
// a pulsing dot and each quality's leader in turn.
export function LiveTicker({
	period,
	open,
	sheetOpen,
	onToggle,
}: {
	period: BoardWindow;
	open: boolean;
	sheetOpen: boolean;
	onToggle: () => void;
}) {
	const [tick, setTick] = useState(0);
	const leaders = QUALITIES.flatMap((q) => {
		const first = period.top[q.id][0];
		return first ? [{ quality: q.id, label: q.label, title: first.post.title }] : [];
	});
	const leader = leaders.length > 0 ? leaders[tick % leaders.length] : null;

	useEffect(() => {
		if (!open || leaders.length < 2) return;
		const timer = setInterval(() => setTick((t) => t + 1), TICK_MS);
		return () => clearInterval(timer);
	}, [open, leaders.length]);

	return (
		<Slot open={open}>
			<button
				type="button"
				className="island-live"
				aria-expanded={sheetOpen}
				aria-controls="island-board"
				aria-label="Live board"
				onClick={onToggle}
			>
				<span className="live-dot" aria-hidden="true" />
				<span className="island-ticker" aria-hidden="true">
					{leader && (
						<span key={`${leader.quality}-${tick}`} className="ticker-item">
							<QualityIcon name={leader.quality} />
							<b>#1 {leader.label}</b>
							<span className="ticker-title">{leader.title}</span>
						</span>
					)}
				</span>
			</button>
		</Slot>
	);
}

// The whole board, dropped down from the island as a glass sheet.
export function LiveSheet({ board, period, open }: { board: Board; period: BoardWindow; open: boolean }) {
	return (
		<div id="island-board" className="island-sheet" data-open={open || undefined} inert={!open}>
			<header className="island-sheet-head">
				<span>
					<span className="live-dot" aria-hidden="true" />
					Live · {period.label}
				</span>
				<WindowSwitch board={board} selected={period.id} />
			</header>
			<BoardLists period={period} compact />
		</div>
	);
}
