import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QUALITIES } from "../../lib/qualities";
import type { PostPage } from "../../lib/types";
import { CommentComposer, CommentList } from "../Comments";
import { QualityChoices } from "../Qualities";
import { QualityIcon } from "../QualityIcon";
import { RollingNumber } from "../RollingNumber";
import { Sheet } from "../Sheet";

const REFRESH_MS = 20_000;

// Reading a piece: a second, smaller island under the first, with what
// readers made of it. The qualities chosen and their counts open a sheet to
// say how it read to you; the comment count opens the comments, with yours
// to write at the foot. The counts roll like the live board's, and catch up
// on their own every so often while the page is in front of you.
export function ReaderIsland({ post }: { post: PostPage }) {
	const router = useRouter();
	const [open, setOpen] = useState<"qualities" | "comments" | null>(null);
	const close = () => setOpen(null);
	const chosen = QUALITIES.filter((q) => (post.qualities[q.id] ?? 0) > 0);
	const said = chosen.map((q) => `${q.label} ${post.qualities[q.id]}`).join(", ");
	const comments = post.comments;

	// Not while a sheet is open: nothing should shift under your hand.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.invalidate();
		}, REFRESH_MS);
		return () => clearInterval(timer);
	}, [router]);

	return (
		<div className="reader-island" role="group" aria-label="What readers made of this piece">
			<button
				type="button"
				className="reader-seg"
				aria-haspopup="dialog"
				aria-label={said ? `How it read: ${said}. Say how it read to you` : "Say how it read to you"}
				onClick={() => setOpen("qualities")}
			>
				{chosen.length > 0
					? chosen.map((q) => (
							<span key={q.id} className="signal" data-mine={post.mine.includes(q.id) || undefined}>
								<QualityIcon name={q.id} />
								<RollingNumber value={post.qualities[q.id] ?? 0} />
							</span>
						))
					: QUALITIES.map((q) => (
							<span key={q.id} className="signal signal-quiet">
								<QualityIcon name={q.id} />
							</span>
						))}
			</button>
			<span className="island-divider" aria-hidden="true" />
			<button
				type="button"
				className="reader-seg"
				aria-haspopup="dialog"
				aria-label={comments === 1 ? "1 comment" : `${comments} comments`}
				onClick={() => setOpen("comments")}
			>
				<span className="signal signal-comments">
					<QualityIcon name="comments" />
					{comments > 0 ? <RollingNumber value={comments} /> : "Comment"}
				</span>
			</button>

			<Sheet open={open === "qualities"} onClose={close} title="How did this read to you?">
				<QualityChoices post={post} />
			</Sheet>
			<Sheet
				open={open === "comments"}
				onClose={close}
				title={comments > 0 ? `Comments · ${comments}` : "Comments"}
				footer={<CommentComposer post={post} />}
			>
				<CommentList post={post} />
			</Sheet>
		</div>
	);
}
