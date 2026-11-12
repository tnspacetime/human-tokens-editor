import { useSyncExternalStore } from "react";
import type { Board, BoardWindow } from "./types";

// What the live board and the island share. The board (on the feed) puts its
// data here and says when it has scrolled away ("docked"); the island then
// shows a live ticker, and can drop the board down as a sheet. Both use the
// same chosen time window.
export type LiveState = {
	board: Board | null;
	window: BoardWindow["id"];
	docked: boolean;
	sheet: boolean;
};

const initial: LiveState = { board: null, window: "7d", docked: false, sheet: false };
let state = initial;
const listeners = new Set<() => void>();

export const live = {
	get: () => state,
	set(patch: Partial<LiveState>) {
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	},
	subscribe(listener: () => void) {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
};

export function useLive() {
	return useSyncExternalStore(live.subscribe, live.get, () => initial);
}

export function currentWindow(s: LiveState) {
	return s.board?.windows.find((w) => w.id === s.window) ?? s.board?.windows.at(-1) ?? null;
}
