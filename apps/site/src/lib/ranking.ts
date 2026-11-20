import { useSyncExternalStore } from "react";
import type { Ranking, RankingPeriod } from "./types";

// What a board (the homepage's ranking, the archive's All time) and the island share. The ranking puts
// its data here and says when it has scrolled away ("docked"); the island
// then carries it, and can drop it down as a sheet. Both show the same
// chosen period.
export type RankingState = {
	ranking: Ranking | null;
	period: RankingPeriod["id"];
	docked: boolean;
	sheet: boolean;
};

const initial: RankingState = { ranking: null, period: "week", docked: false, sheet: false };
let state = initial;
const listeners = new Set<() => void>();

export const rankingState = {
	get: () => state,
	set(patch: Partial<RankingState>) {
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function useRankingState() {
	return useSyncExternalStore(rankingState.subscribe, rankingState.get, () => initial);
}

export function currentPeriod(s: RankingState) {
	return s.ranking?.periods.find((p) => p.id === s.period) ?? s.ranking?.periods.at(-1) ?? null;
}

/** "Today's best", "This week's best", "This month's best", "Best of all time". */
export const bestOf = (period: RankingPeriod) => (period.id === "all" ? "Best of all time" : `${period.label}’s best`);

/** Short names for the period switch. */
export const SHORT: Record<RankingPeriod["id"], string> = { day: "Today", week: "Week", month: "Month", all: "All time" };
