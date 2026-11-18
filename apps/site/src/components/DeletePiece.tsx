import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { PostPage } from "../lib/types";
import { deletePostFn } from "../server/site.functions";
import { Sheet } from "./Sheet";

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// At the foot of your own piece: Delete, after a sheet that says what goes
// with it. Then you land on your page, without it.
export function DeletePiece({ post }: { post: PostPage }) {
	const navigate = useNavigate();
	const [asking, setAsking] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const reactions = Object.values(post.qualities).reduce((sum, n) => sum + (n ?? 0), 0);
	const goes = [
		reactions > 0 && count(reactions, "reaction", "reactions"),
		post.comments > 0 && count(post.comments, "comment", "comments"),
		post.postscripts.length > 0 && count(post.postscripts.length, "P.S.", "P.S.es"),
	].filter(Boolean);

	const close = () => {
		if (!busy) {
			setAsking(false);
			setError(null);
		}
	};
	const remove = async () => {
		setBusy(true);
		setError(null);
		try {
			await deletePostFn({ data: { id: post.id } });
			await navigate({ to: "/@{$handle}", params: { handle: post.author.handle }, replace: true });
		} catch {
			setError("Couldn't delete it. Try again.");
			setBusy(false);
		}
	};

	return (
		<>
			<div className="author-tools">
				<span>Your piece</span>
				<button type="button" className="link-button author-tools-delete" onClick={() => setAsking(true)}>
					Delete…
				</button>
			</div>
			<Sheet
				open={asking}
				onClose={close}
				title="Delete this piece?"
				footer={
					<div className="comment-form-actions">
						{error && <span className="delete-error">{error}</span>}
						<button type="button" className="link-button" onClick={close} disabled={busy}>
							Cancel
						</button>
						<button type="button" className="primary danger" onClick={remove} disabled={busy}>
							{busy ? "Deleting…" : "Delete"}
						</button>
					</div>
				}
			>
				<p className="sheet-lede">
					“{post.title}” comes off the site for good{goes.length > 0 ? `, with its ${goes.join(", ")}` : ""}. This can't be undone.
				</p>
				<p className="sheet-lede">Your file in Fold MD stays as it is, so you can publish it again as a new piece.</p>
			</Sheet>
		</>
	);
}
