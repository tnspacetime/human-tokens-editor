import { imageSources } from "@human-tokens/renderer";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { refreshYou, type You } from "../../lib/you";
import { Sheet } from "../Sheet";
import { SignInPrompt } from "../SignIn";
import { type Draft, fixable, type PublishedPost } from "./draft";

// Publishing from the writer: the same steps as Fold MD's publish sheet
// (FoldMD/PublishSheet.swift), through the same API (routes/api.fold.$.ts),
// which takes your sign-in cookie from the site's own pages. Sign in if
// you haven't; on your first post, choose how you'll appear; see how it
// starts in the feed; promise you wrote it yourself; publish. Within 15
// minutes, publishing again fixes it.

type Preview = {
	title: string | null;
	opening: string[];
	words: number;
	minutes: number;
	limitReached: string | null;
	duplicate: { id: string; title: string; url: string; publishedAt: string } | null;
};

type Published = { id: string; url: string; title: string; fixableUntil: string | null; created: boolean };

class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

async function api<T>(path: string, method: "POST" | "PUT", body: unknown): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`/api/fold/${path}`, {
			method,
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			credentials: "same-origin",
		});
	} catch {
		throw new ApiError(0, "Couldn't reach the site. Check your connection and try again.");
	}
	const data = (await response.json().catch(() => ({}))) as { error?: string };
	if (!response.ok) throw new ApiError(response.status, data.error ?? "Something went wrong on the site. Try again.");
	return data as T;
}

/** A handle from a name: "Ada Lovelace" → "adalovelace". */
const suggestedHandle = (name: string) =>
	name
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "")
		.slice(0, 30);

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });

const LOCKED =
	"Its text is locked now: it's been up for more than 15 minutes, or someone else has reacted or commented. To publish this version, start it as a new post.";

export function PublishFlow({
	open,
	onClose,
	you,
	draft,
	onPublished,
	onStartNew,
}: {
	open: boolean;
	onClose: () => void;
	you: You | null;
	draft: Draft;
	onPublished: (post: PublishedPost, sourceId: string) => void;
	onStartNew: () => void;
}) {
	const published = draft.published;
	const changed = published ? draft.text !== published.markdown : true;
	const fixing = Boolean(published && changed && fixable(published));
	// Already up as it is: say so, rather than offering to publish it again.
	const showingPublished = Boolean(published && !changed);

	let title = "Publish";
	let body: React.ReactNode;
	if (showingPublished && published) {
		title = "Published";
		body = <PublishedStep post={published} onStartNew={onStartNew} onClose={onClose} />;
	} else if (!you) {
		body = <p className="publish-quiet">Checking who you are…</p>;
	} else if (!you.user) {
		body = (
			<>
				<p className="publish-message">Your draft stays here while you sign in.</p>
				<SignInPrompt action="publish" />
			</>
		);
	} else if (!you.user.author) {
		title = "How you'll appear";
		body = <AuthorStep accountName={you.user.name} />;
	} else {
		title = fixing ? "Fix" : "Publish";
		body = (
			<PublishStep
				key={open ? "open" : "closed"}
				draft={draft}
				fixing={fixing}
				author={you.user.author}
				onPublished={onPublished}
			/>
		);
	}

	return (
		<Sheet open={open} onClose={onClose} title={title}>
			{body}
		</Sheet>
	);
}

/** Your first post: the name readers see, and a short handle (once). */
function AuthorStep({ accountName }: { accountName: string }) {
	const [name, setName] = useState(accountName);
	const [handle, setHandle] = useState(suggestedHandle(accountName));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function save(event: React.FormEvent) {
		event.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api("author", "POST", { name, handle });
			await refreshYou();
		} catch (failure) {
			setError((failure as Error).message);
			setBusy(false);
		}
	}

	return (
		<form className="publish-form" onSubmit={save}>
			<p className="publish-message">
				This is your first post here. Choose the name readers see on your posts, and a short handle.
			</p>
			<label className="publish-field">
				<span>Name</span>
				<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required disabled={busy} />
			</label>
			<label className="publish-field">
				<span>Handle</span>
				<input
					value={handle}
					onChange={(e) => setHandle(e.target.value.replace(/^@/, "").toLowerCase())}
					maxLength={30}
					required
					autoCapitalize="none"
					autoCorrect="off"
					spellCheck={false}
					disabled={busy}
				/>
			</label>
			<p className="publish-fine">A handle is 2 to 30 letters, numbers, - or _. Your page will be /@{handle || "handle"}.</p>
			{error && <p className="publish-error">{error}</p>}
			<div className="publish-buttons">
				<button type="submit" className="publish-primary" disabled={busy || !name.trim() || handle.length < 2}>
					{busy ? "Saving…" : "Continue"}
				</button>
			</div>
		</form>
	);
}

/** How it starts in the feed, the checks, the promise, and Publish (or Fix). */
function PublishStep({
	draft,
	fixing,
	author,
	onPublished,
}: {
	draft: Draft;
	fixing: boolean;
	author: { name: string; handle: string };
	onPublished: (post: PublishedPost, sourceId: string) => void;
}) {
	const [preview, setPreview] = useState<Preview | null>(null);
	const [pledged, setPledged] = useState(false);
	const [anyway, setAnyway] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const pictures = imageSources(draft.text).length;

	useEffect(() => {
		let current = true;
		api<Preview>("preview", "POST", { markdown: draft.text })
			.then((answer) => current && setPreview(answer))
			.catch((failure) => current && setError((failure as Error).message));
		return () => {
			current = false;
		};
	}, [draft.text]);

	const duplicate = !fixing ? preview?.duplicate : null;
	const blocked = !fixing && Boolean(preview?.limitReached);
	const canPublish =
		Boolean(preview?.title) && pictures === 0 && pledged && !blocked && (!duplicate || anyway) && !busy;

	async function publish() {
		setBusy(true);
		setError(null);
		// Locked, or never published: a new post, under a new id when the old one is taken.
		const sourceId = draft.published && !fixing ? `web-${crypto.randomUUID().replace(/-/g, "")}` : draft.sourceId;
		try {
			const post = await api<Published>("posts", "PUT", { sourceId, markdown: draft.text, pledge: true });
			onPublished({ id: post.id, url: post.url, title: post.title, fixableUntil: post.fixableUntil, markdown: draft.text }, sourceId);
		} catch (failure) {
			setError(failure instanceof ApiError && failure.status === 423 ? LOCKED : (failure as Error).message);
			setBusy(false);
		}
	}

	const until = draft.published?.fixableUntil ? ` until ${time(draft.published.fixableUntil)}` : "";
	return (
		<div className="publish-form">
			<p className="publish-message">
				{fixing
					? `Nobody else has reacted or commented yet, so you can still fix it${until}. After that its text is locked.`
					: "This is how it starts in the feed. For 15 minutes after you publish, until someone else reacts or comments, you can still fix it. Then its text is locked, so it stays as readers saw it. Its link works at once; it joins the feed and your page when the 15 minutes are up."}
			</p>

			<div className="publish-card">
				{preview ? (
					<>
						<p className="publish-card-byline">
							{author.name} · {preview.minutes} min read
						</p>
						<p className={preview.title ? "publish-card-title" : "publish-card-title is-missing"}>
							{preview.title ?? "Untitled"}
						</p>
						{preview.opening.slice(0, 2).map((paragraph, i) => (
							<p key={i} className="publish-card-opening">
								{paragraph}
							</p>
						))}
					</>
				) : (
					<p className="publish-quiet">{error ? " " : "Reading it as the feed will…"}</p>
				)}
			</div>

			{preview && !preview.title && <p className="publish-warning">Give it a title first: a first line like “# My title”.</p>}
			{pictures > 0 && (
				<p className="publish-warning">
					{pictures === 1 ? "It has a picture" : `It has ${pictures} pictures`}: pictures can't go up from the browser
					yet. Take {pictures === 1 ? "it" : "them"} out, or publish it from <Link to="/write">Fold MD</Link>.
				</p>
			)}
			{blocked && <p className="publish-warning">{preview?.limitReached}</p>}
			{duplicate && (
				<div className="publish-duplicate">
					<p>
						You published “{duplicate.title}” on {day(duplicate.publishedAt)}.{" "}
						<a href={duplicate.url} target="_blank" rel="noreferrer">
							View it
						</a>
					</p>
					<label className="publish-check">
						<input type="checkbox" checked={anyway} onChange={(e) => setAnyway(e.target.checked)} disabled={busy} />
						<span>Publish this as a new post anyway</span>
					</label>
				</div>
			)}

			<label className="publish-check publish-pledge">
				<input type="checkbox" checked={pledged} onChange={(e) => setPledged(e.target.checked)} disabled={busy} />
				<span>
					<strong>I wrote this myself. No AI wrote or rewrote any of it.</strong>
					<Link to="/rules" target="_blank">
						Read the rules
					</Link>
				</span>
			</label>

			{error && <p className="publish-error">{error}</p>}
			<div className="publish-buttons">
				<button type="button" className="publish-primary" disabled={!canPublish} onClick={publish}>
					{busy ? (fixing ? "Fixing…" : "Publishing…") : fixing ? "Fix" : "Publish"}
				</button>
			</div>
		</div>
	);
}

/** It's up: its link, and starting the next one. */
function PublishedStep({ post, onStartNew, onClose }: { post: PublishedPost; onStartNew: () => void; onClose: () => void }) {
	const open = fixable(post);
	return (
		<div className="publish-form">
			<p className="publish-message">
				“{post.title}” is up. Its link works at once; it joins the feed and your page when its 15 minutes are up.
				{open && post.fixableUntil
					? ` Until ${time(post.fixableUntil)}, while nobody else has reacted or commented, you can still change it here and fix it.`
					: ""}
			</p>
			<div className="publish-buttons">
				<button
					type="button"
					className="publish-secondary"
					onClick={() => {
						onStartNew();
						onClose();
					}}
				>
					Start a new post
				</button>
				<a className="publish-primary" href={post.url}>
					View it
				</a>
			</div>
		</div>
	);
}
