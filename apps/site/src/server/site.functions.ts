import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { isTheme, THEME_COOKIE } from "../lib/theme";
import { isQuality } from "../lib/qualities";
import { loadBoard } from "./board.server";
import { deleteComment, saveAuthorNote, saveComment } from "./comments.server";
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

/** A page of the feed; pass the previous page's `next` to get the one after. */
export const getFeed = createServerFn({ method: "GET" })
	.validator((input: unknown) => {
		const before = input === undefined ? undefined : object(input).before;
		if (before !== undefined && (typeof before !== "string" || before.length > 64)) throw new Error("Bad page");
		return { before };
	})
	.handler(async ({ data }) => {
		currentReader();
		return listFeed(data.before);
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
