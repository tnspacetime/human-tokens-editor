import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { Archive, ArchiveItem } from "../lib/types";
import { getArchiveLines } from "../server/site.functions";
import { Signals } from "./PostCard";
import { RankingBoard } from "./Ranking";

const monthName = (month: number) =>
	new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString("en", { month: "long", timeZone: "UTC" });
const monthYear = (iso: string) =>
	new Date(iso).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Every post ever published, one month at a time: the All time board on
// top, then the years and the chosen year's months, then that month as a
// list of one line per post, 100 at a time as you scroll. A place to hold
// everything, as plain as an index. Stored 15 minutes (lib/keep.ts).
export function ArchivePage({ archive }: { archive: Archive }) {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		<main className="archive">
			<RankingBoard ranking={archive.board} />

			<header className="archive-head">
				<p className="archive-eyebrow">Human Tokens</p>
				<h1>Every post</h1>
				<p className="archive-intro">
					{archive.total === 0
						? "Nothing published yet."
						: `${plural(archive.total, "post", "posts")}, every word written by a person${archive.since ? `, since ${monthYear(archive.since)}` : ""}.`}
				</p>
			</header>

			{archive.years.length > 0 && (
				<nav className="archive-years" aria-label="Years">
					{archive.years.map((y) => (
						<Link
							key={y.year}
							to="/archive/$year"
							params={{ year: String(y.year) }}
							aria-current={y.year === archive.year ? "page" : undefined}
						>
							{y.year}
							<span className="archive-count">{y.count}</span>
						</Link>
					))}
				</nav>
			)}

			{archive.months.length > 1 && (
				<nav className="archive-months" aria-label={`Months of ${archive.year}`}>
					{archive.months.map((m) => (
						<Link
							key={m.month}
							to="/archive/$year/$month"
							params={{ year: String(archive.year), month: pad(m.month) }}
							aria-current={m.month === archive.month ? "page" : undefined}
						>
							{monthName(m.month).slice(0, 3)}
						</Link>
					))}
				</nav>
			)}

			{/* Keyed on what it first shows too: back on the same month after a post settles or goes, the lines start afresh. */}
			{archive.month !== null && (
				<ArchiveMonth
					key={`${archive.year}-${archive.month}~${archive.items.length}~${archive.items[0]?.id ?? ""}~${archive.next ?? ""}`}
					archive={archive}
					month={archive.month}
				/>
			)}
		</main>
	);
}

/** How far below the screen the next lines start loading, so they're usually there before you reach them. */
const AHEAD = "0px 0px 1600px 0px";

/** The chosen month: its first lines with the page, the rest as you scroll. */
function ArchiveMonth({ archive, month }: { archive: Archive; month: number }) {
	const [items, setItems] = useState(archive.items);
	const [next, setNext] = useState(archive.next);
	const [loading, setLoading] = useState(false);
	const [failed, setFailed] = useState(false);
	const end = useRef<HTMLDivElement>(null);
	const name = monthName(month);
	const count = archive.months.find((m) => m.month === month)?.count ?? items.length;

	async function loadMore() {
		if (!next || loading) return;
		setLoading(true);
		setFailed(false);
		try {
			const batch = await getArchiveLines({ data: { month: `${archive.year}-${String(month).padStart(2, "0")}`, after: next } });
			setItems((already) => [...already, ...batch.items]);
			setNext(batch.next);
		} catch {
			setFailed(true);
		} finally {
			setLoading(false);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-armed as the list grows and loads, not on every render.
	useEffect(() => {
		const marker = end.current;
		if (!marker || !next || loading || failed) return;
		const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && loadMore(), { rootMargin: AHEAD });
		observer.observe(marker);
		return () => observer.disconnect();
	}, [items.length, next, loading, failed]);

	return (
		<>
			<MonthOfPieces id={name.toLowerCase()} title={`${name} ${archive.year}`} count={count} items={items} />
			{(next || failed) && (
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
			)}
		</>
	);
}

/**
 * One month of pieces: its name, how many, then a card of one line per piece
 * (its day once in the margin, the title, who wrote it unless `byAuthor`
 * says the whole page is theirs, and what readers made of it).
 */
export function MonthOfPieces({ id, title, count, items, byAuthor }: { id: string; title: string; count?: number; items: ArchiveItem[]; byAuthor?: boolean }) {
	return (
		<section id={id} className="archive-month" aria-labelledby={`${id}-title`}>
			<h2 id={`${id}-title`}>
				{title}
				<span>{plural(count ?? items.length, "post", "posts")}</span>
			</h2>
			<ol className="archive-list">
				{items.map((item, i) => (
					<li key={item.id}>
						<Link to="/p/$id/$slug" params={{ id: item.id, slug: item.slug }}>
							<time
								className="archive-day"
								dateTime={item.publishedAt}
								// The day once, on its first line, like a diary's margin.
								data-same={item.publishedAt.slice(0, 10) === items[i - 1]?.publishedAt.slice(0, 10) || undefined}
							>
								<span className="archive-day-n">{Number(item.publishedAt.slice(8, 10))}</span>
								<span className="archive-day-w">{weekday(item.publishedAt)}</span>
							</time>
							<span className="archive-piece">
								<span className="archive-title">{item.title}</span>
								<span className="archive-meta">
									{!byAuthor && (
										<>
											{item.author}
											<span aria-hidden="true"> · </span>
										</>
									)}
									{item.minutes} min read
								</span>
							</span>
							<Signals post={item} />
						</Link>
					</li>
				))}
			</ol>
		</section>
	);
}
