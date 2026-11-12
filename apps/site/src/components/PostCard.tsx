import { Link } from "@tanstack/react-router";
import { QUALITIES } from "../lib/qualities";
import type { FeedItem } from "../lib/types";
import { QualityIcon } from "./QualityIcon";
import { ShapeCover } from "./ShapeCover";

export function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function Byline({ post }: { post: FeedItem }) {
	return (
		<div className="byline">
			<p className="byline-author">{post.author.name}</p>
			<p className="byline-date">
				<time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
				<span aria-hidden="true"> · </span>
				{post.minutes} min read
			</p>
		</div>
	);
}

export type TileSize = "hero" | "half" | "third";

// A tile in the feed, after Apple Newsroom: a cover (the piece drawn as its
// own page, which turns into its opening words when you point at it), who
// wrote it in small grey capitals, the headline, and a foot with the date
// and what readers made of it.
export function PostTile({ post, size }: { post: FeedItem; size: TileSize }) {
	return (
		<Link to="/p/$id/$slug" params={{ id: post.id, slug: post.slug }} className={`tile tile-${size}`}>
			<div className="tile-cover">
				<ShapeCover shape={post.shape} />
				{/* Pointing at the tile, the drawing gives way to the words. */}
				<div className="cover-text" aria-hidden="true">
					{post.opening.map((paragraph, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs in fixed order
						<p key={index} style={{ ["--p" as string]: index }}>
							{paragraph}
						</p>
					))}
				</div>
				<span className="cover-cta" aria-hidden="true">
					Continue reading
					<svg viewBox="0 0 16 16">
						<path d="M3.5 8h8.5M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</div>
			<div className="tile-body">
				<p className="tile-eyebrow">{post.author.name}</p>
				<h2 className="tile-headline">{post.title}</h2>
				{size === "hero" && post.excerpt && <p className="tile-excerpt">{post.excerpt}</p>}
				<div className="tile-foot">
					<p className="tile-stamp">
						<svg viewBox="0 0 16 16" aria-hidden="true">
							<circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
							<path d="M8 4.6V8l2.3 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
						</svg>
						<time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
					</p>
					<Signals post={post} />
				</div>
			</div>
		</Link>
	);
}

// What readers made of it: each quality someone chose, and the comments.
function Signals({ post }: { post: FeedItem }) {
	const chosen = QUALITIES.filter((q) => (post.qualities[q.id] ?? 0) > 0);
	if (chosen.length === 0 && post.comments === 0) return null;
	const said = chosen.map((q) => `${q.label} ${post.qualities[q.id]}`);
	if (post.comments > 0) said.push(`${post.comments} ${post.comments === 1 ? "comment" : "comments"}`);
	return (
		<p className="tile-signals" aria-label={said.join(", ")}>
			{chosen.map((q) => (
				<span key={q.id} className="signal" title={`${q.label}: ${q.hint.toLowerCase()}`} aria-hidden="true">
					<QualityIcon name={q.id} />
					{post.qualities[q.id]}
				</span>
			))}
			{post.comments > 0 && (
				<span className="signal" title="Comments" aria-hidden="true">
					<QualityIcon name="comments" />
					{post.comments}
				</span>
			)}
		</p>
	);
}
