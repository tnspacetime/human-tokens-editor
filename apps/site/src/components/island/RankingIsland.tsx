import { useEffect, useState } from "react";
import { QUALITIES } from "../../lib/qualities";
import { bestOf } from "../../lib/ranking";
import type { Ranking, RankingPeriod } from "../../lib/types";
import { BoardLists, BoardToggle, PeriodSwitch } from "../Ranking";
import { QualityIcon } from "../QualityIcon";
import { Slot } from "./Slot";

const TICK_MS = 3200;

// The ranking, carried by the island once it has scrolled off the homepage:
// each quality's leader in turn.
export function RankingTicker({
	period,
	open,
	sheetOpen,
	onToggle,
}: {
	period: RankingPeriod;
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
				aria-label={bestOf(period)}
				onClick={onToggle}
			>
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

// The whole ranking, dropped down from the island as a glass sheet.
export function RankingSheet({ ranking, period, open }: { ranking: Ranking; period: RankingPeriod; open: boolean }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div id="island-board" className="island-sheet" data-open={open || undefined} inert={!open}>
			<header className="island-sheet-head">
				<span>
					{bestOf(period)}
					<small>Ranked {ranking.cadence}</small>
				</span>
				{ranking.periods.length > 1 && <PeriodSwitch ranking={ranking} selected={period.id} />}
			</header>
			<BoardLists id="island-board-lists" period={period} compact expanded={expanded} />
			<BoardToggle
				period={period}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
				controls="island-board-lists"
			/>
		</div>
	);
}
