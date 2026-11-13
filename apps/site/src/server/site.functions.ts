import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { isTheme, THEME_COOKIE } from "../lib/theme";
import { isQuality } from "../lib/qualities";
import { loadBoard } from "./board.server";
import { deleteComment, saveAuthorNote, saveComment } from "./comments.server";
import { countPosts, loadArchive } from "./archive.server";
import { listFeed } from "./feed.server";
import { loadPost } from "./posts.server";
import { toggleQuality } from "./reactions.server";
import { currentReader, setAuthorMode, startNewReader } from "./reader.server";

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

export const getViewer = createServerFn({ method: "GET" }).handler(async () => {
	const reader = currentReader();
	const theme = getCookie(THEME_COOKIE);
	return { name: reader.name, asAuthor: reader.asAuthor, theme: isTheme(theme) ? theme : ("system" as const) };
});

/** How many pieces the homepage shows before it hands over to the archive. */
export const HOME_COUNT = 30;

/** The homepage: the newest pieces, and how many there are in all. */
export const getHome = createServerFn({ method: "GET" }).handler(async () => {
	currentReader();
	const [feed, total] = await Promise.all([listFeed(undefined, HOME_COUNT), countPosts()]);
	return { items: feed.items, total };
});

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
		currentReader();
		const archive = await loadArchive(data.year);
		if (!archive) throw notFound();
		return archive;
	});

export const getPost = createServerFn({ method: "GET" })
	.validator((input: unknown) => ({ id: postId(object(input).id) }))
	.handler(async ({ data }) => {
		const post = await loadPost(data.id, currentReader());
		if (!post) throw notFound();
		return post;
	});

export const toggleQualityFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, quality } = object(input);
		if (!isQuality(quality)) throw new Error("Unknown quality");
		return { id: postId(id), quality };
	})
	.handler(async ({ data }) => {
		await toggleQuality(data.id, data.quality, currentReader());
	});

export const saveCommentFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { id, body } = object(input);
		return { id: postId(id), body: text(body, "Comment", MAX_COMMENT) };
	})
	.handler(async ({ data }) => {
		const reader = currentReader();
		if (data.body) await saveComment(data.id, data.body, reader);
		else await deleteComment(data.id, reader);
	});

export const saveAuthorNoteFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => {
		const { commentId, note } = object(input);
		if (typeof commentId !== "string") throw new Error("Unknown comment");
		return { commentId, note: text(note, "Note", MAX_NOTE) };
	})
	.handler(async ({ data }) => {
		// PROTOTYPE: "View as author" stands in for owning the piece; with
		// sign-in, check that the signed-in person wrote it.
		if (!currentReader().asAuthor) throw new Error("Only the author can add a note");
		await saveAuthorNote(data.commentId, data.note || null);
	});

export const newReaderFn = createServerFn({ method: "POST" }).handler(async () => {
	startNewReader();
});

export const setAuthorModeFn = createServerFn({ method: "POST" })
	.validator((input: unknown) => ({ on: object(input).on === true }))
	.handler(async ({ data }) => {
		setAuthorMode(data.on);
	});
