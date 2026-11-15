import { createFileRoute } from "@tanstack/react-router";
import { auth } from "../server/auth.server";

// Better Auth's endpoints: sign-in redirects, the Google and GitHub
// callbacks (/api/auth/callback/google, /api/auth/callback/github), the
// session, sign-out, and on localhost the dev sign-in.
export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => auth.handler(request),
			POST: ({ request }) => auth.handler(request),
		},
	},
});
