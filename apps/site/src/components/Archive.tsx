import { Link } from "@tanstack/react-router";
import type { Archive, ArchiveItem } from "../lib/types";
import { Signals } from "./PostCard";

const monthName = (month: number) =>
	new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString("en", { month: "long", timeZone: "UTC" });
const monthYear = (iso: string) =>
	new Date(iso).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
const weekday = (iso: string) => new Date(iso).toLocaleDateString("en", { weekday: "short", timeZone: "UTC" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Every piece ever published, one year at a time: the years along the top,
// then that year's months (with a row of them to jump between), each a list
// of one line per piece. A place to hold everything, as plain as an index.
export function ArchivePage({ archive }: { archive: Archive }) {
	return (
		<main className="archive">
			<header className="archive-head">
				<p className="archive-eyebrow">Human Tokens</p>
				<h1>Every piece</h1>
				<p className="archive-intro">
					{archive.total === 0
						? "Nothing published yet."
						: `${plural(archive.total, "piece", "pieces")}, every word written by a person${archive.since ? `, since ${monthYear(archive.since)}` : ""}.`}
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
						<a key={m.month} href={`#${monthName(m.month).toLowerCase()}`}>
							{monthName(m.month).slice(0, 3)}
						</a>
					))}
				</nav>
			)}

			{archive.months.map((m) => {
				const name = monthName(m.month);
				return <MonthOfPieces key={m.month} id={name.toLowerCase()} title={name} items={m.items} />;
			})}
		</main>
	);
}

/**
 * One month of pieces: its name, how many, then a card of one line per piece
 * (its day once in the margin, the title, who wrote it unless `byAuthor`
 * says the whole page is theirs, and what readers made of it).
 */
export function MonthOfPieces({ id, title, items, byAuthor }: { id: string; title: string; items: ArchiveItem[]; byAuthor?: boolean }) {
	return (
		<section id={id} className="archive-month" aria-labelledby={`${id}-title`}>
			<h2 id={`${id}-title`}>
				{title}
				<span>{plural(items.length, "piece", "pieces")}</span>
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
