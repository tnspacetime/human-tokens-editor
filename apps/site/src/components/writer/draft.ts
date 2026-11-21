// The writer's draft, kept in this browser only (localStorage): the text,
// the id the site knows it by (so publishing it again within 15 minutes
// fixes the post instead of making a new one, as Fold MD does with a file),
// and, once it's published, that post. Nothing here leaves the browser
// until you publish.

export type PublishedPost = {
	id: string;
	url: string;
	title: string;
	/** Until when it can still be fixed; null once it's locked. */
	fixableUntil: string | null;
	/** The text as published, to tell whether it has changed since. */
	markdown: string;
};

export type Draft = { text: string; sourceId: string; published: PublishedPost | null };

const KEY = "ht.write.draft";

/** A new id for the site to know a draft by: like Fold MD's, [0-9A-Za-z-], 8 to 64 long. */
export const newSourceId = () => `web-${crypto.randomUUID().replace(/-/g, "")}`;

export const emptyDraft = (): Draft => ({ text: "", sourceId: newSourceId(), published: null });

export function loadDraft(): Draft {
	try {
		const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
		if (saved && typeof saved.text === "string" && typeof saved.sourceId === "string") {
			return { text: saved.text, sourceId: saved.sourceId, published: saved.published ?? null };
		}
	} catch {}
	return emptyDraft();
}

/** False when the browser won't keep it (storage turned off or full). */
export function saveDraft(draft: Draft): boolean {
	try {
		localStorage.setItem(KEY, JSON.stringify(draft));
		return true;
	} catch {
		return false;
	}
}

/** Whether the post can still be fixed (its 15 minutes, nobody else has reacted). */
export const fixable = (post: PublishedPost | null) =>
	Boolean(post?.fixableUntil && Date.parse(post.fixableUntil) > Date.now());

/** A file name for Download: the title, made safe, or "Untitled". */
export function fileName(title: string | null) {
	const name = (title ?? "")
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return `${name || "Untitled"}.md`;
}

/** Save the text as a .md file. */
export function download(text: string, title: string | null) {
	const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName(title);
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
