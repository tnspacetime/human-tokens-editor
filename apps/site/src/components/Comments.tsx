import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import type { Comment, PostPage } from "../lib/types";
import { saveAuthorNoteFn, saveCommentFn } from "../server/site.functions";
import { formatDate } from "./PostCard";

// One comment per reader, no replies. To argue with a post, write your own
// and respond (later: "Write a response"), or join its debate if the author
// allows one.
export function Comments({ post }: { post: PostPage }) {
	const mine = post.commentList.find((c) => c.mine);
	const others = post.commentList.filter((c) => !c.mine);
	return (
		<section className="comments" aria-labelledby="comments-title">
			<h2 id="comments-title" className="section-title">
				Comments
			</h2>
			<p className="comments-rule">
				One comment each, and no replies. Say what you think of the piece.
				{post.allowDebate && " The author has opened this post to debate."}
			</p>
			<CommentForm post={post} mine={mine} />
			<ul className="comment-list">
				{others.map((comment) => (
					<CommentItem key={comment.id} comment={comment} isAuthor={post.viewer.isAuthor} authorName={post.author.name} />
				))}
			</ul>
		</section>
	);
}

function CommentForm({ post, mine }: { post: PostPage; mine?: Comment }) {
	const router = useRouter();
	const [editing, setEditing] = useState(!mine);
	const [body, setBody] = useState(mine?.body ?? "");
	const [saving, setSaving] = useState(false);

	async function save(event: FormEvent, text = body) {
		event.preventDefault();
		setSaving(true);
		try {
			await saveCommentFn({ data: { id: post.id, body: text } });
			await router.invalidate();
			setEditing(!text.trim());
			if (!text.trim()) setBody("");
		} finally {
			setSaving(false);
		}
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
			</div>
		);
	}

	return (
		<form className="comment-form" onSubmit={save}>
			<label htmlFor="comment-body" className="visually-hidden">
				Your comment
			</label>
			<textarea
				id="comment-body"
				value={body}
				onChange={(e) => setBody(e.target.value)}
				placeholder={`Commenting as ${post.viewer.name}`}
				rows={3}
				maxLength={2000}
			/>
			<div className="comment-form-actions">
				{mine && (
					<button type="button" className="link-button" onClick={() => setEditing(false)}>
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

	async function saveNote(event: FormEvent) {
		event.preventDefault();
		await saveAuthorNoteFn({ data: { commentId: comment.id, note } });
		await router.invalidate();
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
					<button type="submit" className="primary">
						Save
					</button>
					<button type="button" className="link-button" onClick={() => setWriting(false)}>
						Cancel
					</button>
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
