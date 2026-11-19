import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { isTheme, THEME_COOKIE } from "../lib/theme";
import { isQuality } from "../lib/qualities";
import { loadBoard } from "./board.server";
import { deleteComment, saveAuthorNote, saveComment } from "./comments.server";
import { countPosts, loadArchive } from "./archive.server";
import { deleteOwnPost, loadAuthorPage } from "./authors.server";
import { listFeed } from "./feed.server";
import { loadPost } from "./posts.server";
import { toggleQuality } from "./reactions.server";
import { currentUser, requireUser, signInOptions } from "./auth.server";
import { devSignInAllowed } from "./dev-sign-in.server";

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

export const getBoard = createServerFn({ method: "GET" }).handler(() => loadBoard());

/** Who's here (null when signed out), the ways in, and the chosen theme. */
export const getViewer = createServerFn({ method: "GET" }).handler(async () => {
	const user = await currentUser();
	const theme = getCookie(THEME_COOKIE);
	return {
		user: user && { name: user.name, image: user.image, author: user.author && { handle: user.author.handle, name: user.author.name } },
		signIn: signInOptions(getRequest()),
		theme: isTheme(theme) ? theme : ("system" as const),
	};
});

/** How many pieces the homepage shows before it hands over to the archive. */
export const HOME_COUNT = 100;
/** How many come at a time: the first with the page, the rest as you scroll. */
export const HOME_PAGE = 24;

/** The homepage's first pieces, and how many there are in all. */
export const getHome = createServerFn({ method: "GET" }).handler(async () => {
	const [feed, total] = await Promise.all([listFeed(undefined, HOME_PAGE), countPosts()]);
	return { ...feed, total };
});

/** The next pieces after `before` (the previous page's `next`), at most a page. */
export const getFeed = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { before, limit } = object(input);
		if (typeof before !== "string" || before.length > 64) throw new Error("Bad page");
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > HOME_PAGE) throw new Error("Bad limit");
		return { before, limit };
	})
	.handler(async ({ data }) => listFeed(data.before, data.limit));

/** Every piece of one year (the latest, without one), in months. */
export const getArchive = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const year = input === undefined ? undefined : object(input).year;
		if (year !== undefined && (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 3000)) {
			throw new Error("Bad year");
		}
		return { year };
	})
	.handler(async ({ data }) => {
		const archive = await loadArchive(data.year);
		if (!archive) throw notFound();
		return archive;
	});

export const getPost = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		const post = await loadPost(data.id, await currentUser());
		if (!post) throw notFound();
		return post;
	});

/** An author's page, by handle. */
export const getAuthorPage = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const { handle } = object(input);
		if (typeof handle !== "string" || !/^[A-Za-z0-9_-]{2,30}$/.test(handle)) throw new Error("Unknown author");
		return { handle };
	})
	.handler(async ({ data }) => {
		const page = await loadAuthorPage(data.handle, await currentUser());
		if (!page) throw notFound();
		return page;
	});

/** The author deletes one of their pieces, from its page on the site. */
export const deletePostFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		const user = await requireUser("delete a post");
		if (!(await deleteOwnPost(data.id, user))) throw new Error("Only its author can delete a post");
	});

export const toggleQualityFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, quality } = object(input);
		if (!isQuality(quality)) throw new Error("Unknown quality");
		return { id: postId(id), quality };
	})
	.handler(async ({ data }) => {
		await toggleQuality(data.id, data.quality, await requireUser("say how a post read"));
	});

export const saveCommentFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, body } = object(input);
		return { id: postId(id), body: text(body, "Comment", MAX_COMMENT) };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("comment");
		if (data.body) await saveComment(data.id, data.body, user);
		else await deleteComment(data.id, user);
	});

export const saveAuthorNoteFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { commentId, note } = object(input);
		if (typeof commentId !== "string") throw new Error("Unknown comment");
		return { commentId, note: text(note, "Note", MAX_NOTE) };
	})
	.handler(async ({ data }) => {
		const user = await requireUser("add a note");
		if (!(await saveAuthorNote(data.commentId, data.note || null, user))) throw new Error("Only the author can add a note");
	});

/** The dev sign-in page: only on localhost in `vite dev`, otherwise not found. */
export const getDevSignIn = createServerFn({ method: "GET" }).handler(async () => {
	if (!devSignInAllowed(getRequest())) throw notFound();
	const { results } = await env.DB.prepare("SELECT handle, name FROM authors ORDER BY name").all<{ handle: string; name: string }>();
	return { authors: results };
});
