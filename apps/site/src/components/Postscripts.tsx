import type { PostPage } from "../lib/types";
import { formatDate } from "./PostCard";

// The author's P.S.es: added after publishing, dated, never edited. At the
// end of the piece, and in the reader island's P.S. sheet.
export function Postscripts({ post }: { post: PostPage }) {
	return post.postscripts.map((ps) => (
		<div key={ps.id} className="postscript">
			<p className="postscript-label">
				P.S. <time dateTime={ps.createdAt}>{formatDate(ps.createdAt)}</time>
			</p>
			{/* Rendered on the server by @human-tokens/renderer, which escapes HTML. */}
			<div className="fold-content postscript-body" dangerouslySetInnerHTML={{ __html: ps.html }} />
		</div>
	));
}
