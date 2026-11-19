import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "./auth.server";
import { db } from "./rows.server";

// The Macs Fold MD is connected on, for the account panel: each a session
// Fold MD got from /connect, which it publishes with. Disconnecting one
// here ends it, so that Mac can't publish as you until it connects again
// (say, a lost laptop).

export type FoldConnection = {
	id: string;
	/** The Mac's name, as Fold MD gave it (older versions didn't). */
	mac: string | null;
	since: string;
	lastUsed: string;
};

/** Fold MD says who it is: "Fold MD/1.0 (Mac name)"; before, macOS said "Fold%20MD/1 CFNetwork/…". */
const FOLD_SESSION = "(user_agent LIKE 'Fold MD/%' OR user_agent LIKE 'Fold\\%20MD/%' ESCAPE '\\')";

function macName(userAgent: string): string | null {
	const named = /^Fold MD\/\S+ \((.+)\)$/.exec(userAgent);
	if (!named) return null;
	try {
		return decodeURIComponent(named[1]);
	} catch {
		return named[1];
	}
}

export const getFoldConnections = createServerFn({ method: "GET" }).handler(async (): Promise<FoldConnection[]> => {
	const user = await requireUser("see where Fold MD is connected");
	const { results } = await db()
		.prepare(`SELECT id, user_agent, expires_at, created_at, updated_at FROM sessions WHERE user_id = ? AND ${FOLD_SESSION} ORDER BY updated_at DESC`)
		.bind(user.id)
		.all<{ id: string; user_agent: string; expires_at: string; created_at: string; updated_at: string }>();
	const now = Date.now();
	return results
		.filter((row) => !(Date.parse(row.expires_at) <= now))
		.map((row) => ({ id: row.id, mac: macName(row.user_agent), since: row.created_at, lastUsed: row.updated_at }));
});

export const disconnectFold = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const id = (input as { id?: unknown } | null)?.id;
		if (typeof id !== "string" || id.length > 100) throw new Error("Bad connection");
		return { id };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("disconnect Fold MD");
		await db().prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ? AND ${FOLD_SESSION}`).bind(data.id, user.id).run();
		return { ok: true };
	});
