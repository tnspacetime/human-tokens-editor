import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { getRequest } from "@tanstack/react-start/server";
import { isQuality } from "../lib/qualities";
import { deleteComment, saveAuthorNote, saveComment } from "./comments.server";
import { loadArchive, loadArchiveLines } from "./archive.server";
import { authorIdFor, deleteOwnPost, loadAuthorPage, loadAuthorPosts } from "./authors.server";
import { listFeed } from "./feed.server";
import { loadComments, loadPost, loadPostLive, loadPostYou } from "./posts.server";
import { ARCHIVE_KEEP, HOME_KEEP, keepAuthor, keepPost, LIVE_KEEP_SECONDS } from "../lib/keep";
import { loadRanking } from "./ranking.server";
import { forget, keepResponse, pagesShowing, TAGS } from "./cache.server";
import { toggleQuality } from "./reactions.server";
import { currentUser, requireUser, signInOptions } from "./auth.server";
import { devSignInAllowed } from "./dev-sign-in.server";
import { slowDown } from "./limits.server";

const MAX_COMMENT = 2000;
const MAX_NOTE = 280;

function object(input: unknown): Record<string, unknown> {
	if (typeof input !== "object" || input === null) throw new Error("Expected an object");
	return input as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number) {
	if (typeof value !== "string") throw new Error(`${name} must be text`);
	const trimmed = value.trim();
	if (trimmed.length > max) throw new Error(`${name} is too long`);
	return trimmed;
}

const postId = (value: unknown) => {
	if (typeof value !== "string" || !/^[0-9A-Za-z]{6,16}$/.test(value)) throw new Error("Unknown post");
	return value;
};

/** Text from an address, checked by the handler: a bad one is "not found", not an error. */
const fromAddress = (value: unknown) => (typeof value === "string" ? value.slice(0, 200) : "");

/** The ranking as last worked out (hourly), stored like the homepage. */
export const getRanking = createServerFn({ method: "GET" }).handler(async () => {
	keepResponse(HOME_KEEP);
	return loadRanking();
});

/**
 * Who's here (null when signed out): "You", fetched by the browser after the
 * page, so every page can be the same for everyone. Never stored. The
 * browser asks only when it has signed in (lib/you.ts); signed out, it
 * doesn't touch the database anyway.
 */
export const getYou = createServerFn({ method: "GET" }).handler(async () => {
	keepResponse("never");
	return youOf(await currentUser());
});

/** Who you are, as the browser shows it (lib/you.ts). */
const youOf = (user: Awaited<ReturnType<typeof currentUser>>) =>
	user && { name: user.name, image: user.image, author: user.author && { handle: user.author.handle, name: user.author.name } };

/**
 * The ways in (Google, GitHub; Dev on localhost), the same for every reader:
 * built into every page by the root route. It says nothing about storing,
 * so a page that's never stored stays never stored.
 */
export const getSignInOptions = createServerFn({ method: "GET" }).handler(() => signInOptions(getRequest()));

/** How many pieces the homepage shows before it hands over to the archive. */
export const HOME_COUNT = 100;
/** How many come at a time: the first with the page, the rest as you scroll. */
export const HOME_PAGE = 24;

/** The homepage's first posts: stored 5 minutes (HOME_KEEP). */
export const getHome = createServerFn({ method: "GET" }).handler(async () => {
	keepResponse(HOME_KEEP);
	return listFeed(undefined, HOME_PAGE);
});

/** The next pieces after `before` (the previous page's `next`), at most a page. */
export const getFeed = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { before, limit } = object(input);
		if (typeof before !== "string" || before.length > 64) throw new Error("Bad page");
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > HOME_PAGE) throw new Error("Bad limit");
		return { before, limit };
	})
	.handler(async ({ data }) => {
		keepResponse(HOME_KEEP);
		return listFeed(data.before, data.limit);
	});

/** A page of the archive: one month (the latest of a year, or of all, without one), and the All time board. Stored 15 minutes. */
export const getArchive = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { year, month } = input === undefined ? {} : object(input);
		const whole = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
		if (year !== undefined && !whole(year, 0, 9999)) throw new Error("Bad year");
		if (month !== undefined && (year === undefined || !whole(month, 1, 12))) throw new Error("Bad month");
		return { year: year as number | undefined, month: month as number | undefined };
	})
	.handler(async ({ data }) => {
		// A year or month with nothing in it is "not found" (loadArchive).
		const archive = await loadArchive(data.year, data.month);
		if (!archive) throw notFound();
		keepResponse(ARCHIVE_KEEP);
		return archive;
	});

/** More of a month's lines, after `after` (the last batch's `next`). Stored like the archive. */
export const getArchiveLines = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { month, after } = object(input);
		if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Bad month");
		if (typeof after !== "string" || after.length > 64) throw new Error("Bad page");
		return { month, after };
	})
	.handler(async ({ data }) => {
		keepResponse(ARCHIVE_KEEP);
		return loadArchiveLines(data.month, data.after);
	});

/**
 * A post's page, the same for everyone. With the slug in the address: when
 * it isn't the post's current one, only that is looked up ({ movedTo }), so
 * the redirect comes before any of the page is built.
 */
export const getPost = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { id, slug } = object(input);
		return { id: fromAddress(id), slug: typeof slug === "string" ? slug : undefined };
	})
	.handler(async ({ data }) => {
		if (!/^[0-9A-Za-z]{6,16}$/.test(data.id)) throw notFound();
		const post = await loadPost(data.id, data.slug);
		if (!post) throw notFound();
		keepResponse(keepPost(data.id, "movedTo" in post ? post.fixable : post.fixableUntil !== null));
		return post;
	});

/** What readers made of a post, as it is now: the same for everyone, stored 5 minutes (LIVE_KEEP_SECONDS). */
export const getPostLive = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		const live = await loadPostLive(data.id);
		if (!live) throw notFound();
		keepResponse({ seconds: LIVE_KEEP_SECONDS, tags: [TAGS.postLive(data.id)] });
		return live;
	});

/** More of a post's comments, after `after` (the last page's `next`): stored like Live. */
export const getPostComments = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { id, after } = object(input);
		if (typeof after !== "string" || after.length > 100) throw new Error("Bad page");
		return { id: postId(id), after };
	})
	.handler(async ({ data }) => {
		keepResponse({ seconds: LIVE_KEEP_SECONDS, tags: [TAGS.postLive(data.id)] });
		return loadComments(data.id, data.after);
	});

/** What's yours on a post. Never kept. */
export const getPostYou = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		keepResponse("never");
		// Who you are comes along, so a post page asks once (lib/you.ts).
		const user = await currentUser();
		return { user: youOf(user), post: await loadPostYou(data.id, user) };
	});

/** After you react or comment: the post as it is now, for you (the stored copy can be 5 minutes behind). */
async function freshFor(id: string, user: Awaited<ReturnType<typeof requireUser>>) {
	keepResponse("never");
	const [live, you] = await Promise.all([loadPostLive(id), loadPostYou(id, user)]);
	return { live, you };
}

const HANDLE = /^[A-Za-z0-9_-]{2,30}$/;

/** An author's page, by handle: the same for everyone, stored 15 minutes (keepAuthor). */
export const getAuthorPage = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ handle: fromAddress(object(input).handle) }))
	.handler(async ({ data }) => {
		if (!HANDLE.test(data.handle)) throw notFound();
		const page = await loadAuthorPage(data.handle);
		if (!page) throw notFound();
		keepResponse(keepAuthor(page.author.handle));
		return page;
	});

/** More of an author's posts, after `after` (the last batch's `next`). Stored like their page. */
export const getAuthorPosts = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { handle, after } = object(input);
		if (typeof handle !== "string" || !HANDLE.test(handle)) throw new Error("Unknown author");
		if (typeof after !== "string" || after.length > 64) throw new Error("Bad page");
		return { handle, after };
	})
	.handler(async ({ data }) => {
		const id = await authorIdFor(data.handle);
		if (!id) throw notFound();
		keepResponse(keepAuthor(data.handle));
		return loadAuthorPosts(id, data.after);
	});

/** The author deletes one of their pieces, from its page on the site. */
export const deletePostFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		const user = await requireUser("delete a post");
		const showing = await pagesShowing(data.id);
		if (!(await deleteOwnPost(data.id, user))) throw new Error("Only its author can delete a post");
		await forget([...showing, TAGS.home, TAGS.archive, ...(user.author ? [TAGS.author(user.author.handle)] : [])]);
	});

export const toggleQualityFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, quality } = object(input);
		if (!isQuality(quality)) throw new Error("Unknown quality");
		return { id: postId(id), quality };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("say how a post read");
		await slowDown("REACTIONS", user.id);
		await toggleQuality(data.id, data.quality, user);
		return freshFor(data.id, user);
	});

export const saveCommentFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, body } = object(input);
		return { id: postId(id), body: text(body, "Comment", MAX_COMMENT) };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("comment");
		await slowDown("WRITING", user.id);
		if (data.body) await saveComment(data.id, data.body, user);
		else await deleteComment(data.id, user);
		return freshFor(data.id, user);
	});

export const saveAuthorNoteFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, commentId, note } = object(input);
		if (typeof commentId !== "string") throw new Error("Unknown comment");
		return { id: postId(id), commentId, note: text(note, "Note", MAX_NOTE) };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("add a note");
		await slowDown("WRITING", user.id);
		if (!(await saveAuthorNote(data.commentId, data.note || null, user))) throw new Error("Only the author can add a note");
		return freshFor(data.id, user);
	});

/** The dev sign-in page: only on localhost in `vite dev`, otherwise not found. */
export const getDevSignIn = createServerFn({ method: "GET" }).handler(async () => {
	keepResponse("never");
	if (!devSignInAllowed(getRequest())) throw notFound();
	const { results } = await env.DB.prepare("SELECT handle, name FROM authors ORDER BY name").all<{ handle: string; name: string }>();
	return { authors: results };
});
