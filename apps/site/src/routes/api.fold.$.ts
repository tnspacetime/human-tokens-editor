import { createFileRoute } from "@tanstack/react-router";
import {
	addPostscript,
	becomeAuthor,
	preview,
	PublishError,
	publish,
	published,
	publisherFrom,
	unpublish,
} from "../server/publish.server";

// The publishing API Fold MD talks to, with `Authorization: Bearer <token>`
// (the token it got when you connected it at /connect). JSON in and out;
// a refusal is { error } with a sentence Fold MD shows as it is.
//
//   GET    /api/fold/me              who you are, and your author name if you have one
//   POST   /api/fold/author          { name, handle }: become an author (once)
//   POST   /api/fold/preview         { markdown }: the title and opening lines the feed will show
//   PUT    /api/fold/posts           { sourceId, markdown, follows?, parts?, pledge: true }: publish, or fix;
//                                    follows: the id of an earlier piece of yours this new one follows up;
//                                    parts: for a whole series joined into one piece, how many chapters (h2s)
//                                    (only for 15 minutes, and until anyone reacts or comments; then 423)
//   GET    /api/fold/posts/<id>      one of your posts as it stands, with fixableUntil (null once locked)
//                                    and its postscripts
//   POST   /api/fold/posts/<id>/ps   { body, pledge: true }: add a P.S. under it (at most 150 words; never edited)
//   DELETE /api/fold/posts/<id>      unpublish it
//
// Connecting itself is Better Auth's: POST /api/auth/device/code and
// /api/auth/device/token with client_id "fold-md".
export const Route = createFileRoute("/api/fold/$")({
	server: {
		handlers: {
			GET: ({ request, params }) => handle(request, params._splat),
			POST: ({ request, params }) => handle(request, params._splat),
			PUT: ({ request, params }) => handle(request, params._splat),
			DELETE: ({ request, params }) => handle(request, params._splat),
		},
	},
});

async function handle(request: Request, path = "") {
	try {
		const origin = new URL(request.url).origin;
		const method = request.method;
		const parts = path.split("/").filter(Boolean);
		const publisher = await publisherFrom(request);

		if (parts[0] === "me" && parts.length === 1 && method === "GET") {
			return reply({ user: { name: publisher.name, image: publisher.image }, author: publisher.author });
		}
		if (parts[0] === "author" && parts.length === 1 && method === "POST") {
			return reply({ author: await becomeAuthor(publisher, await body(request)) });
		}
		if (parts[0] === "preview" && parts.length === 1 && method === "POST") {
			return reply(preview(await body(request)));
		}
		if (parts[0] === "posts" && parts.length === 1 && method === "PUT") {
			const post = await publish(publisher, await body(request), origin);
			return reply(post, post.created ? 201 : 200);
		}
		if (parts[0] === "posts" && parts.length === 2) {
			if (method === "GET") return reply(await published(publisher, parts[1], origin));
			if (method === "DELETE") {
				await unpublish(publisher, parts[1]);
				return reply({ ok: true });
			}
		}
		if (parts[0] === "posts" && parts.length === 3 && parts[2] === "ps" && method === "POST") {
			return reply({ postscript: await addPostscript(publisher, parts[1], await body(request)) }, 201);
		}
		return reply({ error: "Not found." }, 404);
	} catch (error) {
		if (error instanceof PublishError) return reply({ error: error.message }, error.status);
		console.error("api/fold", error);
		return reply({ error: "Something went wrong on the site. Try again." }, 500);
	}
}

async function body(request: Request): Promise<Record<string, unknown>> {
	try {
		const value = await request.json();
		if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
	} catch {}
	throw new PublishError(400, "Expected a JSON object.");
}

const reply = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});
