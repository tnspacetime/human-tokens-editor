import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { LiveBoard } from "../components/LiveBoard";
import { PostTile } from "../components/PostCard";
import { RulesPill } from "../components/Rules";
import { tileSizes } from "../components/tileSizes";
import { useFeedMotion } from "../components/useFeedMotion";
import { share } from "../lib/share";
import type { FeedItem } from "../lib/types";
import { getBoard, getFeed, getHome, HOME_COUNT, HOME_PAGE } from "../server/site.functions";

export const Route = createFileRoute("/")({
	loader: async () => {
		const [home, board] = await Promise.all([getHome(), getBoard()]);
		return { home, board };
	},
	head: () => share({ path: "/" }),
	component: Feed,
});

// What's loaded beyond the first page, kept while you read a piece: coming
// back, the flow is as long as you left it, so the browser can put you back
// where you were. A different first piece (something new was published)
// starts over.
let kept: { first: string; posts: FeedItem[]; next: string | null } | null = null;

// How far below the screen the next pieces start loading, so they're
// usually there before you reach them.
const AHEAD = "0px 0px 1600px 0px";

// The homepage: the live board, then the newest pieces (up to a hundred) in
// one continuous flow, the first ones with the page and the rest as you
// scroll. Everything older lives in the archive, which the flow hands over
// to at its end; dates are the archive's business.
function Feed() {
	const { home, board } = Route.useLoaderData();
	const first = home.items[0]?.id ?? "";
	const resumed = kept?.first === first ? kept : null;
	const [posts, setPosts] = useState<FeedItem[]>(resumed?.posts ?? home.items);
	const [next, setNext] = useState(resumed ? resumed.next : home.next);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const list = useRef<HTMLUListElement>(null);
	const end = useRef<HTMLDivElement>(null);
	useFeedMotion(list, posts.length);

	// A fresh first page with something new at the top starts the flow over.
	const shown = useRef(home);
	useEffect(() => {
		if (shown.current === home) return;
		shown.current = home;
		if (kept?.first === first) return;
		setPosts(home.items);
		setNext(home.next);
	}, [home, first]);

	useEffect(() => {
		kept = { first, posts, next };
	}, [first, posts, next]);

	const room = HOME_COUNT - posts.length;
	const more = next !== null && room > 0;

	async function loadMore() {
		if (!next || loading || room <= 0) return;
		setLoading(true);
		setFailed(false);
		try {
			const page = await getFeed({ data: { before: next, limit: Math.min(HOME_PAGE, room) } });
			setPosts((already) => [...already, ...page.items]);
			setNext(page.next);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}

	// The next pieces load as the end of the flow comes near. (It re-arms
	// after each page, so a page that leaves the end in reach brings the one
	// after it too.)
	useEffect(() => {
		const marker = end.current;
		if (!marker || !more || loading || failed) return;
		const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), { rootMargin: AHEAD });
		observer.observe(marker);
		return () => observer.disconnect();
	});

	const sizes = tileSizes(posts.length, !more);
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
				<>
					<ul ref={list} className="tiles">
						{posts.map((post, i) => (
							<li key={post.id} className={`tiles-item tiles-${sizes[i]}`}>
								<PostTile post={post} size={sizes[i]} />
							</li>
						))}
					</ul>
					{more || failed ? (
						<div ref={end} className="feed-end" aria-live="polite">
							{failed ? (
								<button type="button" className="feed-retry" onClick={loadMore}>
									Couldn't load more. Try again
								</button>
							) : (
								<span className="feed-loading">
									<span className="live-dot" aria-hidden="true" />
									{loading ? "Loading more" : "More below"}
								</span>
							)}
						</div>
					) : (
						<Link to="/archive" className="feed-archive">
							<span className="feed-archive-text">
								<span className="feed-archive-title">Every piece</span>
								<span className="feed-archive-line">
									{home.total > posts.length
										? `${home.total - posts.length} more, ${home.total} in all, by year and month`
										: `All ${home.total}, by year and month`}
								</span>
							</span>
							<svg className="feed-archive-chevron" viewBox="0 0 8 14" aria-hidden="true">
								<path d="M1.5 1.5 6.5 7l-5 5.5" />
							</svg>
						</Link>
					)}
				</>
			)}
		</main>
	);
}
