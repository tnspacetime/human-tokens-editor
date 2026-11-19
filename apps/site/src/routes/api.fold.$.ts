import { createFileRoute } from "@tanstack/react-router";
import { TOO_FAST } from "../lib/limits";
import { missingPictures, uploadPicture } from "../server/images.server";
import { allowed, type Limit } from "../server/limits.server";
import {
	addPostscript,
	becomeAuthor,
	piece,
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
//   POST   /api/fold/preview         { markdown }: the title and opening lines the feed will show,
//                                    limitReached: why you can't publish a new piece just now, or null, and
//                                    duplicate: one of your posts with the same title or opening, or null
//   POST   /api/fold/images          { hashes }: of a piece's pictures (hex SHA-256 of their bytes), the
//                                    ones the site doesn't have yet: { missing }
//   PUT    /api/fold/images/<hash>   a picture's bytes (JPEG, PNG or GIF, at most 5 MB); the piece then
//                                    links it as /img/<hash>. At most 20 pictures, 10 MB, in a piece; every
//                                    picture a piece shows is one of these (no links to other websites).
//   PUT    /api/fold/posts           { sourceId, markdown, respondsTo?, parts?, pledge: true }: publish, or fix;
//                                    respondsTo: the id of the piece this new one responds to, yours (a
//                                    follow-up) or anyone's (a reply);
//                                    parts: for a whole series joined into one piece, how many chapters (h2s)
//                                    (only for 15 minutes, and until anyone else reacts or comments; then 423).
//                                    At most 50 new pieces in 30 days (then 429)
//   GET    /api/fold/posts/<id>      one of your posts as it stands, with fixableUntil (null once locked)
//                                    and its postscripts
//   POST   /api/fold/posts/<id>/ps   { body, pledge: true }: add a P.S. under it (at most 150 words, no
//                                    pictures; never edited; the same one twice is 409)
//   DELETE /api/fold/posts/<id>      unpublish it
//   GET    /api/fold/pieces/<id>     any piece, to respond to: its title, url, author, and whether it's yours
//
// Previews and pictures have a per-minute limit far above what publishing
// needs (src/server/limits.server.ts); past it, 429 and a sentence to show.
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
			await slowDown("PREVIEW", publisher.id);
			return reply(await preview(publisher, await body(request), origin));
		}
		if (parts[0] === "images" && parts.length === 1 && method === "POST") {
			await slowDown("PICTURES", publisher.id);
			return reply({ missing: await missingPictures(publisher, await body(request)) });
		}
		if (parts[0] === "images" && parts.length === 2 && method === "PUT") {
			await slowDown("PICTURES", publisher.id);
			await uploadPicture(publisher, parts[1], request);
			return reply({ ok: true });
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
		if (parts[0] === "pieces" && parts.length === 2 && method === "GET") {
			return reply(await piece(publisher, parts[1], origin));
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

/** A 429 with the "wait a moment" sentence, once this person has used up the limit. */
async function slowDown(limit: Limit, userId: string) {
	if (!(await allowed(limit, userId))) throw new PublishError(429, TOO_FAST);
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
