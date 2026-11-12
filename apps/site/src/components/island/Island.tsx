import { Link, useMatch } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { currentWindow, live, useLive } from "../../lib/live";
import type { Theme } from "../../lib/theme";
import { BrandMark } from "../BrandMark";
import { Account, type Viewer } from "./Account";
import { Appearance } from "./Appearance";
import { LiveSheet, LiveTicker } from "./Live";
import { Slot } from "./Slot";
import { useDismiss } from "./useDismiss";
import { useReading } from "./useReading";

type Panel = "appearance" | "account" | null;

// A small glass capsule floating at the top of every page: the wordmark,
// appearance, and who you are. It changes shape with what you're doing:
// while you read a post it shows the post's title and a hairline of
// progress; opening Appearance or your account unfolds their choices; and
// once the feed's live board has scrolled away it carries it, as a live
// ticker of the leaders that drops the whole board down when tapped.
// One thing shows at a time: an open panel folds the title and ticker away.
export function Island({ viewer }: { viewer: Viewer & { theme: Theme } }) {
	const post = useMatch({ from: "/p/$id/$slug", shouldThrow: false });
	const title = post?.loaderData?.title;
	const dock = useRef<HTMLDivElement>(null);
	const island = useRef<HTMLElement>(null);
	const [panel, setPanel] = useState<Panel>(null);
	const { reading, progress } = useReading(title);
	const liveState = useLive();
	const period = currentWindow(liveState);

	const showTitle = Boolean(title) && reading && !panel;
	const showLive = Boolean(period) && liveState.docked && !panel && !showTitle;
	const sheetOpen = showLive && liveState.sheet;

	const closePanel = useCallback(() => setPanel(null), []);
	const closeSheet = useCallback(() => live.set({ sheet: false }), []);
	useDismiss(panel !== null, island, closePanel);
	useDismiss(sheetOpen, dock, closeSheet);

	const toggle = (which: Exclude<Panel, null>) => {
		live.set({ sheet: false });
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
				{liveState.board && period && (
					<LiveTicker
						period={period}
						open={showLive}
						sheetOpen={sheetOpen}
						onToggle={() => {
							setPanel(null);
							live.set({ sheet: !liveState.sheet });
						}}
					/>
				)}
				<span className="island-divider" aria-hidden="true" />
				<Appearance
					initial={viewer.theme}
					open={panel === "appearance"}
					onToggle={() => toggle("appearance")}
					onClose={closePanel}
				/>
				<Account viewer={viewer} open={panel === "account"} onToggle={() => toggle("account")} />
				{title && <span ref={progress} className="island-progress" aria-hidden="true" />}
			</nav>
			{liveState.board && period && <LiveSheet board={liveState.board} period={period} open={sheetOpen} />}
		</div>
	);
}
