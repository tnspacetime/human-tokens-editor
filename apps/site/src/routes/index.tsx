import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef } from "react";
import { feedSections, sectionSizes } from "../components/feedLayout";
import { LiveBoard } from "../components/LiveBoard";
import { PostTile } from "../components/PostCard";
import { RulesPill } from "../components/Rules";
import { useFeedMotion } from "../components/useFeedMotion";
import { getBoard, getHome } from "../server/site.functions";

export const Route = createFileRoute("/")({
	loader: async () => {
		const [home, board] = await Promise.all([getHome(), getBoard()]);
		return { home, board, now: Date.now() };
	},
	component: Feed,
});

// The homepage: the live board, then the newest pieces (the first thirty)
// in stretches of time. Everything older lives in the archive, which the
// feed hands over to at its end.
function Feed() {
	const { home, board, now } = Route.useLoaderData();
	const posts = home.items;
	const list = useRef<HTMLDivElement>(null);
	useFeedMotion(list, posts.length);

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
				<>
					<div ref={list} className="feed-sections">
						{sections.map((section, index) => {
							const sizes = sectionSizes(section.posts.length, index === 0, true);
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
				</>
			)}
		</main>
	);
}
