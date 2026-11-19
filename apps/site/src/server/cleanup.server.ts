import { sweepPictures } from "./images.server";
import { db } from "./rows.server";

// Run every hour by Cloudflare (wrangler.jsonc, "triggers"; src/server.ts):
// clears out what has expired, so the tables only hold what's still in use.
//
//   sessions       sign-ins past their end (Better Auth ignores them already)
//   device_codes   codes for connecting Fold MD that were never used in time
//   verifications  the short-lived values sign-in uses along the way
//   pictures       uploaded but never published, after a day
//
// Expiry dates are stored as ISO text ("2026-11-19T21:50:03.813Z"), so they
// compare as plain text.
export async function cleanUp(now = new Date()): Promise<Record<string, number>> {
	const iso = now.toISOString();
	const [sessions, deviceCodes, verifications] = await db().batch([
		db().prepare("DELETE FROM sessions WHERE expires_at < ?").bind(iso),
		db().prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(iso),
		db().prepare("DELETE FROM verifications WHERE expires_at < ?").bind(iso),
	]);
	// Fifty pictures a sweep; a backlog goes in a few rounds.
	let pictures = 0;
	for (let round = 0; round < 20; round++) {
		const gone = await sweepPictures();
		pictures += gone;
		if (gone < 50) break;
	}
	const counts = {
		sessions: sessions.meta.changes,
		deviceCodes: deviceCodes.meta.changes,
		verifications: verifications.meta.changes,
		pictures,
	};
	console.log("cleanup", counts);
	return counts;
}
