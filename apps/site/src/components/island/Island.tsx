import { Link, useMatch } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useDeleted } from "../../lib/deleted";
import { currentPeriod, rankingState, useRankingState } from "../../lib/ranking";
import { useYou } from "../../lib/you";
import { BrandMark } from "../BrandMark";
import { Account } from "./Account";
import { Appearance } from "./Appearance";
import { RankingSheet, RankingTicker } from "./RankingIsland";
import { AuthorIsland } from "./AuthorIsland";
import { ReaderIsland } from "./ReaderIsland";
import { Slot } from "./Slot";
import { useDismiss } from "./useDismiss";
import { useReading } from "./useReading";

type Panel = "appearance" | "account" | null;

// A small glass capsule floating at the top of every page: the wordmark,
// appearance, who you are, and Write, which leads to the editor. It changes
// shape with what you're doing: while you read a post it shows the post's
// title and a hairline of progress; opening Appearance or your account
// unfolds their choices; and once the homepage's ranking has scrolled away
// it carries it, as a ticker of the leaders that drops the whole ranking
// down when tapped.
// One thing shows at a time: an open panel folds the title and ticker away.
// On a post, a second island under it carries what readers made of it;
// on an author's page, what they've written and what readers found in it.
export function Island() {
	const you = useYou();
	const match = useMatch({ from: "/p/$id/$slug", shouldThrow: false });
	const author = useMatch({ from: "/@{$handle}", shouldThrow: false });
	// A post you've just deleted (lib/deleted.ts) is no post: its page says so.
	const deleted = useDeleted();
	const post = match?.loaderData && deleted.has(match.loaderData.id) ? undefined : match;
	const title = post?.loaderData?.title;
	const dock = useRef<HTMLDivElement>(null);
	const island = useRef<HTMLElement>(null);
	const [panel, setPanel] = useState<Panel>(null);
	const { reading, progress } = useReading(title);
	const ranked = useRankingState();
	const period = currentPeriod(ranked);

	const showTitle = Boolean(title) && reading && !panel;
	const showLive = Boolean(period) && ranked.docked && !panel && !showTitle;
	const sheetOpen = showLive && ranked.sheet;

	const closePanel = useCallback(() => setPanel(null), []);
	const closeSheet = useCallback(() => rankingState.set({ sheet: false }), []);
	useDismiss(panel !== null, island, closePanel);
	useDismiss(sheetOpen, dock, closeSheet);

	const toggle = (which: Exclude<Panel, null>) => {
		rankingState.set({ sheet: false });
		setPanel(panel === which ? null : which);
	};

	return (
		<div ref={dock} className="island-dock">
			<nav
				ref={island}
				className="island"
				data-reading={showTitle || undefined}
				data-live={showLive || undefined}
				aria-label="Site"
			>
				<Link to="/" className="island-home" aria-label="Human Tokens, home">
					<BrandMark />
					<Slot open={!showTitle}>
						<span className="island-name">Human Tokens</span>
					</Slot>
				</Link>
				{title && (
					<Slot open={showTitle}>
						<button
							type="button"
							className="island-title"
							onClick={() => scrollTo({ top: 0, behavior: "smooth" })}
							title="Back to the top"
						>
							{title}
						</button>
					</Slot>
				)}
				{ranked.ranking && period && (
					<RankingTicker
						period={period}
						open={showLive}
						sheetOpen={sheetOpen}
						onToggle={() => {
							setPanel(null);
							rankingState.set({ sheet: !ranked.sheet });
						}}
					/>
				)}
				<span className="island-divider" aria-hidden="true" />
				<Appearance
					open={panel === "appearance"}
					onToggle={() => toggle("appearance")}
					onClose={closePanel}
				/>
				<Account you={you} open={panel === "account"} onToggle={() => toggle("account")} />
				{/* On a phone there's room for it only while nothing else unfolds. */}
				<Slot open className="island-write-slot">
					<Link to="/write" className="island-write">
						Write
					</Link>
				</Slot>
				{title && <span ref={progress} className="island-progress" aria-hidden="true" />}
			</nav>
			{/* Keyed: going from one post (or author) to another starts their island afresh, nothing left open. */}
			{post?.loaderData && <ReaderIsland key={post.loaderData.id} post={post.loaderData} />}
			{author?.loaderData && author.loaderData.posts > 0 && <AuthorIsland key={author.loaderData.author.handle} page={author.loaderData} />}
			{ranked.ranking && period && <RankingSheet ranking={ranked.ranking} period={period} open={sheetOpen} />}
		</div>
	);
}
