import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { db } from "./rows.server";

// DEVELOPMENT ONLY. A stand-in for Google and GitHub while there are no
// keys, so the whole flow can be tried on localhost: sign in as a reader by
// name, or as one of the authors (which links that author to you, and gives
// you the author's tools on their pieces). A Better Auth plugin, so it makes
// real users and sessions; auth.server.ts adds it only in `vite dev`, and it
// answers only requests made on this machine. Its users have addresses at
// dev.localhost, which can't receive mail.

export const devSignIn = () =>
	({
		id: "dev-sign-in",
		endpoints: {
			devSignIn: createAuthEndpoint("/dev/sign-in", { method: "POST" }, async (ctx) => {
				if (!ctx.request || !devSignInAllowed(ctx.request)) throw new APIError("NOT_FOUND");
				const body = (ctx.body ?? {}) as { as?: unknown; name?: unknown };
				const as = typeof body.as === "string" ? body.as : "reader";
				const adapter = ctx.context.internalAdapter;
				const findOrCreate = async (email: string, name: string) =>
					(await adapter.findUserByEmail(email))?.user ?? (await adapter.createUser({ email, name, emailVerified: false }, { method: "dev-sign-in" }));

				let user: Awaited<ReturnType<typeof findOrCreate>> | null;
				if (as.startsWith("author:")) {
					const author = await db()
						.prepare("SELECT id, handle, name, user_id FROM authors WHERE handle = ?")
						.bind(as.slice("author:".length))
						.first<{ id: string; handle: string; name: string; user_id: string | null }>();
					if (!author) throw new APIError("BAD_REQUEST", { message: "No such author" });
					user = author.user_id
						? await adapter.findUserById(author.user_id)
						: await findOrCreate(`${author.handle}@dev.localhost`, author.name);
					if (!user) throw new APIError("INTERNAL_SERVER_ERROR");
					await db().prepare("UPDATE authors SET user_id = ? WHERE id = ? AND user_id IS NULL").bind(user.id, author.id).run();
				} else {
					const name = (typeof body.name === "string" ? body.name.trim().slice(0, 60) : "") || "Dev Reader";
					const local = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "reader";
					user = await findOrCreate(`reader-${local}@dev.localhost`, name);
				}

				const session = await adapter.createSession(user.id);
				await setSessionCookie(ctx, { session, user });
				return ctx.json({ ok: true });
			}),
		},
	}) satisfies BetterAuthPlugin;

/**
 * The dev sign-in: only in `vite dev` (it isn't in a production build at
 * all), and only when the page was asked for on this machine.
 */
export function devSignInAllowed(request: Request) {
	if (!import.meta.env.DEV) return false;
	const host = new URL(request.url).hostname;
	return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
}
