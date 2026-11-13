import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "../components/BrandMark";
import { feedSections, sectionSizes } from "../components/feedLayout";
import { LiveBoard } from "../components/LiveBoard";
import { PostTile } from "../components/PostCard";
import { RulesPill } from "../components/Rules";
import { useFeedMotion } from "../components/useFeedMotion";
import type { FeedItem } from "../lib/types";
import { getBoard, getFeed } from "../server/site.functions";

export const Route = createFileRoute("/")({
	loader: async () => {
		const [feed, board] = await Promise.all([getFeed({ data: {} }), getBoard()]);
		return { feed, board, now: Date.now() };
	},
	component: Feed,
});

// What's loaded below the first page, kept while you read a piece: coming
// back, the feed is as long as you left it, so the browser can put you back
// where you were. A different first page (something new was published)
// starts over.
let kept: { first: string; posts: FeedItem[]; next: string | null } | null = null;

// How far below the screen the next page starts loading, so it's usually
// there before you reach it.
const AHEAD = "0px 0px 1600px 0px";

function Feed() {
	const { feed, board, now } = Route.useLoaderData();
	const first = feed.items[0]?.id ?? "";
	const resumed = kept?.first === first ? kept : null;
	const [posts, setPosts] = useState<FeedItem[]>(resumed?.posts ?? feed.items);
	const [next, setNext] = useState(resumed ? resumed.next : feed.next);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const list = useRef<HTMLDivElement>(null);
	const end = useRef<HTMLDivElement>(null);
	useFeedMotion(list, posts.length);

	// A fresh first page (after a reaction, say) starts the feed over.
	const shownFeed = useRef(feed);
	useEffect(() => {
		if (shownFeed.current === feed) return;
		shownFeed.current = feed;
		if (kept?.first === first) return;
		setPosts(feed.items);
		setNext(feed.next);
	}, [feed, first]);

	useEffect(() => {
		kept = { first, posts, next };
	}, [first, posts, next]);

	async function more() {
		if (!next || loading) return;
		setLoading(true);
		setFailed(false);
		try {
			const page = await getFeed({ data: { before: next } });
			setPosts((shown) => [...shown, ...page.items]);
			setNext(page.next);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}

	// Endless: the next page loads as the end of the feed comes near. (It
	// re-arms after each page, so a short page that leaves the end in reach
	// loads the one after it too.)
	useEffect(() => {
		const marker = end.current;
		if (!marker || !next || loading || failed) return;
		const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && more(), { rootMargin: AHEAD });
		observer.observe(marker);
		return () => observer.disconnect();
	});

	const sections = feedSections(posts, now);
	return (
		<main className="feed">
			<h1 className="visually-hidden">Human Tokens</h1>
			<RulesPill />
			<LiveBoard board={board} />
			<header className="section-head">
				<h2>Latest</h2>
				<p>Every word written by a person. No AI wrote or rewrote any of it.</p>
			</header>
			{posts.length === 0 ? (
				<p className="feed-empty">Nothing published yet.</p>
			) : (
				<div ref={list} className="feed-sections">
					{sections.map((section, index) => {
						const complete = next === null || index < sections.length - 1;
						const sizes = sectionSizes(section.posts.length, index === 0, complete);
						return (
							<section key={section.key} className="feed-section" aria-labelledby={`feed-${section.key}`}>
								<h3 id={`feed-${section.key}`} className="feed-section-title">
									{section.label}
								</h3>
								<ul className="tiles">
									{section.posts.map((post, i) => (
										<li key={post.id} className={`tiles-item tiles-${sizes[i]}`}>
											<PostTile post={post} size={sizes[i]} />
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			)}
			<div ref={end} className="feed-end" aria-live="polite">
				{failed ? (
					<button type="button" className="feed-retry" onClick={more}>
						Couldn't load more. Try again
					</button>
				) : next ? (
					// Usually seen only for a moment, while the next page arrives.
					<span className="feed-loading">
						<span className="live-dot" aria-hidden="true" />
						{loading ? "Loading more" : "More below"}
					</span>
				) : (
					posts.length > 0 && (
						<p className="feed-done">
							<BrandMark />
							That's every piece so far.
						</p>
					)
				)}
			</div>
		</main>
	);
}
