import { createFileRoute } from "@tanstack/react-router";
import { TOO_FAST } from "../lib/limits";
import { auth } from "../server/auth.server";
import { addressOf, allowed } from "../server/limits.server";

// Better Auth's endpoints: sign-in redirects, the Google and GitHub
// callbacks (/api/auth/callback/google, /api/auth/callback/github), the
// session, sign-out, and on localhost the dev sign-in.
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => auth.handler(request),
			POST: async ({ request }) => {
				// A code to connect Fold MD: anyone may ask, so each address may ask a few times a minute.
				if (new URL(request.url).pathname === "/api/auth/device/code" && !(await allowed("CONNECT", addressOf(request)))) {
					return Response.json(
						{ error: "slow_down", error_description: TOO_FAST },
						{ status: 429, headers: { "cache-control": "no-store", "retry-after": "60" } },
					);
				}
				return auth.handler(request);
			},
		},
	},
});
