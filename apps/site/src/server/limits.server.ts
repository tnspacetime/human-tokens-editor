import { env } from "cloudflare:workers";
import { TOO_FAST } from "../lib/limits";

// How often each kind of request may come, per person (or, before signing
// in, per address), counted by Cloudflare at the edge (wrangler.jsonc,
// "ratelimits"). Generous for a person, a wall for a script.
//
//   CONNECT    asking for a code to connect Fold MD     10 a minute, per address
//   PREVIEW    Fold MD's publish preview                20 a minute
//   PICTURES   checking and uploading pictures          120 a minute
//   REACTIONS  choosing how a post read                 60 a minute
//   WRITING    comments and author notes                20 a minute
export type Limit = "CONNECT" | "PREVIEW" | "PICTURES" | "REACTIONS" | "WRITING";

type RateLimiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/** False once `key` has used up `limit` for this minute. Without the binding (a test setup), always true. */
export async function allowed(limit: Limit, key: string): Promise<boolean> {
	const limiter = (env as unknown as Partial<Record<Limit, RateLimiter>>)[limit];
	if (!limiter) return true;
	try {
		return (await limiter.limit({ key })).success;
	} catch (error) {
		// Never lock people out because the counter itself failed.
		console.error("rate limit", limit, error);
		return true;
	}
}

/** Throws the "wait a moment" error once `key` has used up `limit`. */
export async function slowDown(limit: Limit, key: string): Promise<void> {
	if (!(await allowed(limit, key))) throw new Error(TOO_FAST);
}

/** Who's asking, before they've signed in: the address Cloudflare saw. */
export function addressOf(request: Request): string {
	return request.headers.get("cf-connecting-ip") ?? "local";
}
