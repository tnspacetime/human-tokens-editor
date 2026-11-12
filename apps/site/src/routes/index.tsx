import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LiveBoard } from "../components/LiveBoard";
import { PostTile, type TileSize } from "../components/PostCard";
import { useFeedMotion } from "../components/useFeedMotion";
import type { FeedItem } from "../lib/types";
import { getBoard, getFeed } from "../server/site.functions";

export const Route = createFileRoute("/")({
	loader: async () => {
		const [feed, board] = await Promise.all([getFeed({ data: {} }), getBoard()]);
		return { feed, board };
	},
	component: Feed,
});

// The newest piece leads across the full width, the next two share a row,
// and the rest come three to a row. At the very end of the feed, rows never
// end half empty: a leftover one or two pair up instead. (Not while more can
// still load, or tiles would change size when the next page arrives.)
function sizeFor(index: number, total: number, complete: boolean): TileSize {
	if (index === 0) return "hero";
	if (index <= 2) return "half";
	if (!complete) return "third";
	const rest = total - 3;
	const paired = rest % 3 === 1 ? 4 : rest % 3 === 2 ? 2 : 0;
	return index >= total - paired ? "half" : "third";
}

function Feed() {
	const { feed, board } = Route.useLoaderData();
	const [posts, setPosts] = useState<FeedItem[]>(feed.items);
	const [next, setNext] = useState(feed.next);
	const [loading, setLoading] = useState(false);
	const list = useRef<HTMLUListElement>(null);
	useFeedMotion(list, posts.length);

	// A fresh first page (after a reaction, say) starts the feed over.
	useEffect(() => {
		setPosts(feed.items);
		setNext(feed.next);
	}, [feed]);

	async function more() {
		if (!next || loading) return;
		setLoading(true);
		try {
			const page = await getFeed({ data: { before: next } });
			setPosts((shown) => [...shown, ...page.items]);
			setNext(page.next);
		} finally {
			setLoading(false);
		}
	}

	const complete = next === null;
	return (
		<main className="feed">
			<h1 className="visually-hidden">Human Tokens</h1>
			<LiveBoard board={board} />
			<header className="section-head">
				<h2>Latest</h2>
				<p>Every word written by a person. No AI wrote or rewrote any of it.</p>
			</header>
			{posts.length === 0 ? (
				<p className="feed-empty">Nothing published yet.</p>
			) : (
				<ul ref={list} className="tiles">
					{posts.map((post, index) => {
						const size = sizeFor(index, posts.length, complete);
						return (
							<li key={post.id} className={`tiles-item tiles-${size}`}>
								<PostTile post={post} size={size} />
							</li>
						);
					})}
				</ul>
			)}
			{next && (
				<div className="feed-more">
					<button type="button" onClick={more} disabled={loading}>
						{loading ? "Loading…" : "More pieces"}
					</button>
				</div>
			)}
		</main>
	);
}
