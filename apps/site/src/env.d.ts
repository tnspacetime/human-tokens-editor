// Secrets for sign-in, from .dev.vars locally (see .dev.vars.example) and
// `wrangler secret put` once deployed. `wrangler types` only sees the ones
// present when it runs, so they're declared here, each optional: a provider
// without its pair simply isn't offered.
declare namespace Cloudflare {
	interface Env {
		/** Signs sessions and encrypts stored tokens; required once deployed. */
		BETTER_AUTH_SECRET?: string;
		/** Where the site is served, e.g. http://localhost:3100. */
		BETTER_AUTH_URL?: string;
		GOOGLE_CLIENT_ID?: string;
		GOOGLE_CLIENT_SECRET?: string;
		GITHUB_CLIENT_ID?: string;
		GITHUB_CLIENT_SECRET?: string;
	}
}
