import { Link } from "@tanstack/react-router";
import type { PostPage } from "../lib/types";

const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "long", day: "numeric", timeZone: "UTC" });

// Pieces by others written in reply to this one, oldest first: each its
// title, who wrote it and when. At the foot of the piece, and in the
// reader island's Replies sheet.
export function Replies({ post }: { post: PostPage }) {
	return (
		<ol className="replies">
			{post.replies.map((reply) => (
				<li key={reply.id}>
					<Link to="/p/$id/$slug" params={{ id: reply.id, slug: reply.slug }} className="reply">
						<span className="reply-title">{reply.title}</span>
						<span className="reply-by">
							{reply.author.name}
							<span aria-hidden="true"> · </span>
							{day(reply.publishedAt)}
						</span>
					</Link>
				</li>
			))}
		</ol>
	);
}
