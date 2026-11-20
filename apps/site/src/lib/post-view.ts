import { useEffect, useSyncExternalStore } from "react";
import { getPostComments, getPostLive, getPostYou, saveAuthorNoteFn, saveCommentFn, toggleQualityFn } from "../server/site.functions";
import type { Quality } from "./qualities";
import type { Comment, PostLive, PostPage, PostView, PostYou } from "./types";
import { LIVE_KEEP_SECONDS } from "./keep";
import { hasSignedIn, learnYou } from "./you";

// A post's page is the same for everyone (Cloudflare stores it). Once it's
// up, the browser asks for what readers made of it (Live: counts and the
// first comments, stored 5 minutes) and what's yours on it (You, never
// stored), and puts them in. The page and the island under the site's
// island share one copy of each.
//
// Your own changes show at once (before the site has answered), and once the
// site has confirmed one, this browser remembers the fresh counts for a
// while: a stored Live from before your change can't hide it on a reload.

type Fresh = { live: PostLive | null; you: PostYou | null };

type State = {
	live?: PostLive;
	/** Comments loaded after Live's first page, and where the next page starts. */
	more: Comment[];
	next?: string | null;
	you?: PostYou | null;
	asked: boolean;
	/** Reactions you've just changed, not yet confirmed: chosen or not. */
	choosing: Partial<Record<Quality, boolean>>;
	/** Your comment as you've just sent it ("" for a delete), not yet confirmed. */
	sending: string | null;
};

const states = new Map<string, State>();
const listeners = new Set<() => void>();
let version = 0;

const blank = (): State => ({ more: [], asked: false, choosing: {}, sending: null });

function update(id: string, change: (state: State) => Partial<State>) {
	const state = states.get(id) ?? blank();
	states.set(id, { ...state, ...change(state) });
	version++;
	for (const listen of listeners) listen();
}

// ── Remembered after your own change, as long as Live is stored ──

const REMEMBER_MS = LIVE_KEEP_SECONDS * 1000;
const memoryKey = (id: string) => `ht-fresh:${id}`;

function remember(id: string, live: PostLive) {
	try {
		sessionStorage.setItem(memoryKey(id), JSON.stringify({ at: Date.now(), live }));
	} catch {}
}

function remembered(id: string): PostLive | null {
	try {
		const saved = JSON.parse(sessionStorage.getItem(memoryKey(id)) ?? "null") as { at: number; live: PostLive } | null;
		return saved && Date.now() - saved.at < REMEMBER_MS ? saved.live : null;
	} catch {
		return null;
	}
}

/** The site has confirmed a change of yours: the post as it is now. */
function putFresh(id: string, fresh: Fresh) {
	if (fresh.live) remember(id, fresh.live);
	update(id, (state) => ({
		...(fresh.live ? { live: fresh.live, next: state.more.length ? state.next : fresh.live.next } : {}),
		you: fresh.you,
	}));
}

// ── Asking ──

function ask(id: string) {
	update(id, () => ({ asked: true }));
	getPostLive({ data: { id } })
		.then((live) => {
			const fresher = remembered(id) ?? live;
			update(id, () => ({ live: fresher, more: [], next: fresher.next }));
		})
		.catch(() => {});
	// Signed out (lib/you.ts), there's nothing of yours to ask for.
	if (!hasSignedIn()) return update(id, () => ({ you: null }));
	// One request: what's yours on this post, and who you are (for the island).
	const answer = getPostYou({ data: { id } });
	void learnYou(answer.then((a) => a.user));
	answer.then((a) => update(id, () => ({ you: a.post }))).catch(() => update(id, () => ({ you: null })));
}

/** Signed in or out: ask again for what's yours on every post seen. */
export function forgetYours() {
	for (const id of states.keys()) update(id, () => ({ you: undefined, asked: false }));
}

/** The next page of comments. */
export async function loadMoreComments(id: string) {
	const after = states.get(id)?.next;
	if (!after) return;
	const page = await getPostComments({ data: { id, after } });
	update(id, (state) => ({ more: [...state.more, ...page.page], next: page.next }));
}

// ── Your changes: shown at once, confirmed by the site ──

/** Choose a quality, or un-choose it. Shows at once; undone if the site says no (the error is thrown). */
export async function toggleReaction(id: string, quality: Quality) {
	const state = states.get(id);
	if (!state || state.choosing[quality] !== undefined) return;
	const chosen = !(state.you?.mine ?? []).includes(quality);
	update(id, (s) => ({ choosing: { ...s.choosing, [quality]: chosen } }));
	try {
		putFresh(id, await toggleQualityFn({ data: { id, quality } }));
	} finally {
		update(id, (s) => {
			const { [quality]: _, ...rest } = s.choosing;
			return { choosing: rest };
		});
	}
}

/** Write, change or (with "") delete your comment. Shows at once; undone if the site says no (the error is thrown). */
export async function saveMyComment(id: string, body: string) {
	update(id, () => ({ sending: body.trim() }));
	try {
		putFresh(id, await saveCommentFn({ data: { id, body } }));
	} finally {
		update(id, () => ({ sending: null }));
	}
}

/**
 * The author's note under someone's comment. The fresh Live holds only the
 * first page of comments, so a comment further down (loaded as you scrolled)
 * gets its note here.
 */
export async function saveNote(id: string, commentId: string, note: string) {
	putFresh(id, await saveAuthorNoteFn({ data: { id, commentId, note } }));
	const authorNote = note.trim() || null;
	update(id, (state) => ({ more: state.more.map((c) => (c.id === commentId ? { ...c, authorNote } : c)) }));
}

// ── The view ──

const subscribe = (listen: () => void) => {
	listeners.add(listen);
	return () => listeners.delete(listen);
};

/** The post page as it shows: the stored page, with Live and You put in once they've come, and your changes on top. */
export function usePostView(post: PostPage): PostView {
	useSyncExternalStore(
		subscribe,
		() => version,
		() => 0,
	);
	const state = states.get(post.id) ?? blank();
	useEffect(() => {
		if (!states.get(post.id)?.asked) ask(post.id);
	}, [post.id, state.asked]);

	const { live, you = null, choosing, sending } = state;

	// Your reactions, with the ones you've just changed.
	const saved = you?.mine ?? [];
	const mine = [...new Set([...saved, ...(Object.keys(choosing) as Quality[])])].filter((q) => choosing[q] ?? saved.includes(q));
	const qualities = { ...live?.qualities };
	for (const [q, chosen] of Object.entries(choosing) as [Quality, boolean][]) {
		if (chosen !== saved.includes(q)) qualities[q] = Math.max(0, (qualities[q] ?? 0) + (chosen ? 1 : -1));
	}

	// Others' comments as loaded, and yours (as you've just sent it) at the foot.
	const myId = you?.myComment?.id;
	const others = [...(live?.page ?? []), ...state.more].filter((c) => c.id !== myId).map((c) => ({ ...c, mine: false }));
	let myComment: (Comment & { mine: true; sending?: boolean }) | null = you?.myComment ? { ...you.myComment, mine: true } : null;
	let comments = live?.comments ?? 0;
	if (sending !== null && you) {
		if (sending === "") {
			if (myComment) comments--;
			myComment = null;
		} else {
			if (!myComment) comments++;
			myComment = { id: myId ?? "sending", name: you.name, body: sending, authorNote: myComment?.authorNote ?? null, createdAt: myComment?.createdAt ?? new Date().toISOString(), mine: true, sending: true };
		}
	}

	return {
		...post,
		live: Boolean(live),
		qualities,
		comments,
		moreComments: Boolean(state.next),
		mine,
		commentList: myComment ? [...others, myComment] : others,
		viewer: you ? { name: you.name, isAuthor: you.isAuthor } : null,
	};
}
