import { useSyncExternalStore } from "react";

// Posts you've just deleted, remembered by this browser. Every list is a
// stored copy (lib/keep.ts), cleared within a minute of a delete, not at once
// (the clearings are rationed). Until then, this browser leaves the post out
// of every list and board, and its own page says you deleted it, so the
// author never sees it still there. Nobody else's pages change.

const KEY = "ht-deleted";
/** Longer than a clearing takes (a minute, or a few if one has to wait for the ration). */
const REMEMBER_MS = 5 * 60_000;

const NONE: ReadonlySet<string> = new Set();
let deleted: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

/** Deleted post ids and when, as saved; those older than REMEMBER_MS are dropped. */
function saved(): Record<string, number> {
	try {
		const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
		const now = Date.now();
		return Object.fromEntries(Object.entries(all).filter(([, at]) => now - at < REMEMBER_MS));
	} catch {
		return {};
	}
}

/** Just deleted, by you: hide it everywhere in this browser from now on. */
export function markDeleted(id: string) {
	const all = { ...saved(), [id]: Date.now() };
	try {
		localStorage.setItem(KEY, JSON.stringify(all));
	} catch {}
	deleted = new Set(Object.keys(all));
	for (const listen of listeners) listen();
}

const subscribe = (listen: () => void) => {
	listeners.add(listen);
	return () => listeners.delete(listen);
};

/** The posts to leave out (none while the page is made on the server). */
export function useDeleted(): ReadonlySet<string> {
	return useSyncExternalStore(
		subscribe,
		() => (deleted ??= new Set(Object.keys(saved()))),
		() => NONE,
	);
}
