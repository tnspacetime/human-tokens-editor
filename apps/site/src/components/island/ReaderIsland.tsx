import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { QUALITIES } from "../../lib/qualities";
import type { PostPage } from "../../lib/types";
import { CommentComposer, CommentList } from "../Comments";
import { Postscripts } from "../Postscripts";
import { QualityChoices } from "../Qualities";
import { QualityIcon } from "../QualityIcon";
import { RollingNumber } from "../RollingNumber";
import { Sheet } from "../Sheet";
import { useDismiss } from "./useDismiss";

const REFRESH_MS = 20_000;

// Reading a piece: a second, smaller island under the first, with what
// readers made of it. The qualities chosen and their counts open a sheet to
// say how it read to you; the comment count opens the comments, with yours
// to write at the foot. Once the author has added a P.S., a P.S. button
// slides it down under the island, without losing your place. The counts roll like the live
// board's, and catch up on their own every so often while the page is in
// front of you.
export function ReaderIsland({ post }: { post: PostPage }) {
	const router = useRouter();
	const [open, setOpen] = useState<"qualities" | "comments" | "ps" | null>(null);
	const close = () => setOpen(null);
	const dock = useRef<HTMLDivElement>(null);
	const closePostscripts = useCallback(() => setOpen((now) => (now === "ps" ? null : now)), []);
	useDismiss(open === "ps", dock, closePostscripts);
	const chosen = QUALITIES.filter((q) => (post.qualities[q.id] ?? 0) > 0);
	const said = chosen.map((q) => `${q.label} ${post.qualities[q.id]}`).join(", ");
	const comments = post.comments;
	const postscripts = post.postscripts.length;

	// Not while a sheet is open: nothing should shift under your hand.
	useEffect(() => {
		const timer = setInterval(() => {
			if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.invalidate();
		}, REFRESH_MS);
		return () => clearInterval(timer);
	}, [router]);

	return (
		<div ref={dock} className="reader-dock">
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

				{postscripts > 0 && (
					<>
						<span className="island-divider" aria-hidden="true" />
						<button
							type="button"
							className="reader-seg"
							aria-expanded={open === "ps"}
							aria-controls="reader-ps"
							aria-label={postscripts === 1 ? "The author added a P.S." : `The author added ${postscripts} P.S.es`}
							onClick={() => setOpen(open === "ps" ? null : "ps")}
						>
							<span className="signal signal-ps">
								P.S.
								{postscripts > 1 && <span className="signal-ps-count">{postscripts}</span>}
							</span>
						</button>
					</>
				)}

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
			{postscripts > 0 && (
				<div id="reader-ps" className="island-sheet ps-sheet" data-open={open === "ps" || undefined} inert={open !== "ps"}>
					<header className="island-sheet-head">
						<span>From the author, since publishing</span>
					</header>
					<Postscripts post={post} />
				</div>
			)}
		</div>
	);
}
