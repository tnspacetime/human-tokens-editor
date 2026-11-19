import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { failure } from "../lib/limits";
import type { Comment, PostPage } from "../lib/types";
import { saveAuthorNoteFn, saveCommentFn } from "../server/site.functions";
import { formatDate } from "./PostCard";
import { SignInPrompt } from "./SignIn";

// One comment per person, no replies. Signed out, you can read them; the
// foot asks you to sign in to write one. To argue with a post, write your
// own and respond to it.
//
// In the comments sheet: the others' comments in the middle (CommentList),
// and yours, or the box to write it, pinned at the foot (CommentComposer).
export function CommentList({ post }: { post: PostPage }) {
	const others = post.commentList.filter((c) => !c.mine);
	return (
		<>
			<p className="sheet-lede">
				One comment each, and no replies. Say what you think of the post.
			</p>
			{others.length === 0 ? (
				<p className="comments-empty">No one else has commented yet.</p>
			) : (
				<ul className="comment-list">
					{others.map((comment) => (
						<CommentItem key={comment.id} comment={comment} isAuthor={post.viewer?.isAuthor ?? false} authorName={post.author.name} />
					))}
				</ul>
			)}
		</>
	);
}

export function CommentComposer({ post }: { post: PostPage }) {
	if (!post.viewer) return <SignInPrompt action="comment" />;
	return <CommentForm post={post} viewerName={post.viewer.name} mine={post.commentList.find((c) => c.mine)} />;
}

function CommentForm({ post, viewerName, mine }: { post: PostPage; viewerName: string; mine?: Comment }) {
	const router = useRouter();
	const [editing, setEditing] = useState(!mine);
	const [body, setBody] = useState(mine?.body ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fieldId = useId();

	async function save(event: FormEvent, text = body) {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await saveCommentFn({ data: { id: post.id, body: text } });
			await router.invalidate();
			setEditing(!text.trim());
			if (!text.trim()) setBody("");
		} catch (problem) {
			setError(failure(problem, text.trim() ? "Your comment didn't save. Try again." : "It didn't delete. Try again."));
		} finally {
			setSaving(false);
		}
	}

	/** Back to the comment as it's saved. */
	function cancelEdit() {
		setBody(mine?.body ?? "");
		setError(null);
		setEditing(false);
	}

	if (mine && !editing) {
		return (
			<div className="comment mine">
				<CommentHeader name={`${mine.name} (you)`} date={mine.createdAt} />
				<p className="comment-body">{mine.body}</p>
				{mine.authorNote && <AuthorNote name={post.author.name} note={mine.authorNote} />}
				<div className="comment-actions">
					<button type="button" className="link-button" onClick={() => setEditing(true)}>
						Edit
					</button>
					<button type="button" className="link-button" onClick={(e) => save(e, "")} disabled={saving}>
						Delete
					</button>
				</div>
				{error && (
					<p className="form-error" role="alert">
						{error}
					</p>
				)}
			</div>
		);
	}

	return (
		<form className="comment-form" onSubmit={save}>
			<label htmlFor={fieldId} className="visually-hidden">
				Your comment
			</label>
			<textarea
				id={fieldId}
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder={`Commenting as ${viewerName}`}
				rows={2}
				maxLength={2000}
			/>
			<div className="comment-form-actions">
				{error && (
					<span className="form-error" role="alert">
						{error}
					</span>
				)}
				{mine && (
					<button type="button" className="link-button" onClick={cancelEdit}>
						Cancel
					</button>
				)}
				<button type="submit" className="primary" disabled={saving || !body.trim()}>
					{mine ? "Save" : "Comment"}
				</button>
			</div>
		</form>
	);
}

function CommentItem({ comment, isAuthor, authorName }: { comment: Comment; isAuthor: boolean; authorName: string }) {
	const router = useRouter();
	const [writing, setWriting] = useState(false);
	const [note, setNote] = useState(comment.authorNote ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function saveNote(event: FormEvent) {
		event.preventDefault();
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await saveAuthorNoteFn({ data: { commentId: comment.id, note } });
			await router.invalidate();
			setWriting(false);
		} catch (problem) {
			setError(failure(problem, "Your note didn't save. Try again."));
		} finally {
			setSaving(false);
		}
	}

	/** Back to the note as it's saved. */
	function cancelNote() {
		setNote(comment.authorNote ?? "");
		setError(null);
		setWriting(false);
	}

	return (
		<li className="comment">
			<CommentHeader name={comment.name} date={comment.createdAt} />
			<p className="comment-body">{comment.body}</p>
			{comment.authorNote && !writing && <AuthorNote name={authorName} note={comment.authorNote} />}
			{isAuthor && !writing && (
				<button type="button" className="link-button" onClick={() => setWriting(true)}>
					{comment.authorNote ? "Edit your note" : "Add a note"}
				</button>
			)}
			{writing && (
				<form className="note-form" onSubmit={saveNote}>
					<input
						// biome-ignore lint/a11y/noAutofocus: opened by the author's own click on "Add a note".
						autoFocus
						value={note}
						onChange={(e) => setNote(e.target.value)}
						maxLength={280}
						placeholder="A short note from you (one per comment)"
						aria-label="Your note on this comment"
					/>
					<button type="submit" className="primary" disabled={saving}>
						{saving ? "Saving…" : "Save"}
					</button>
					<button type="button" className="link-button" onClick={cancelNote} disabled={saving}>
						Cancel
					</button>
					{error && (
						<span className="form-error" role="alert">
							{error}
						</span>
					)}
				</form>
			)}
		</li>
	);
}

function CommentHeader({ name, date }: { name: string; date: string }) {
	return (
		<p className="comment-header">
			<span className="comment-name">{name}</span>
			<span aria-hidden="true"> · </span>
			<time dateTime={date}>{formatDate(date)}</time>
		</p>
	);
}

function AuthorNote({ name, note }: { name: string; note: string }) {
	return (
		<p className="author-note">
			<span className="author-note-label">{name}</span> {note}
		</p>
	);
}
