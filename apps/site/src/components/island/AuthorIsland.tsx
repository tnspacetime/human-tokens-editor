import { useCallback, useRef, useState } from "react";
import { describeQualities, QUALITIES } from "../../lib/qualities";
import type { AuthorPage } from "../../lib/types";
import { QualityIcon } from "../QualityIcon";
import { useDismiss } from "./useDismiss";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });

/** 8,412 · 12.3k · 1.2M */
function compact(n: number) {
	if (n < 10_000) return n.toLocaleString("en");
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

const count = (n: number, one: string, many: string) => `${n === 1 ? one : many}`;

// On an author's page: a second island under the first, like a piece's
// reader island. It says how much they've written and what readers chose;
// tapped, it slides down the whole picture: what readers find in the
// writing, the numbers, and each quality with how often it was chosen.
export function AuthorIsland({ page }: { page: AuthorPage }) {
	const [open, setOpen] = useState(false);
	const dock = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useDismiss(open, dock, close);

	const pieces = page.posts;
	const chosen = QUALITIES.filter((q) => (page.qualities[q.id] ?? 0) > 0);
	const said = describeQualities(page.qualities);
	const most = Math.max(1, ...QUALITIES.map((q) => page.qualities[q.id] ?? 0));
	const reactions = QUALITIES.reduce((sum, q) => sum + (page.qualities[q.id] ?? 0), 0);

	const stats = [
		{ value: pieces, label: count(pieces, "post", "posts") },
		{ value: page.words, label: count(page.words, "word", "words") },
		{ value: page.comments, label: count(page.comments, "comment", "comments") },
	];

	return (
		<div ref={dock} className="reader-dock author-dock">
			<div className="reader-island">
				<button
					type="button"
					className="reader-seg author-seg"
					aria-expanded={open}
					aria-controls="author-sheet"
					onClick={() => setOpen(!open)}
				>
					<span className="author-seg-count">
						{pieces} {count(pieces, "post", "posts")}
					</span>
					{chosen.length > 0 && (
						<>
							<span className="island-divider" aria-hidden="true" />
							{chosen.map((q) => (
								<span key={q.id} className="signal">
									<QualityIcon name={q.id} />
									{page.qualities[q.id]}
								</span>
							))}
						</>
					)}
					{page.comments > 0 && (
						<>
							<span className="island-divider" aria-hidden="true" />
							<span className="signal signal-comments">
								<QualityIcon name="comments" />
								{page.comments}
							</span>
						</>
					)}
					<svg className="author-seg-chevron" viewBox="0 0 12 12" aria-hidden="true">
						<path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</button>
			</div>

			<div id="author-sheet" className="island-sheet author-sheet" data-open={open || undefined} inert={!open}>
				<header className="island-sheet-head">
					<span>{page.author.name} on Human Tokens</span>
				</header>
				<p className="author-sheet-said">
					{said ? (
						<>
							Readers find this writing <strong>{said}</strong>.
						</>
					) : (
						"No reactions yet."
					)}
				</p>
				<dl className="author-sheet-stats">
					{stats.map((stat) => (
						<div key={stat.label}>
							<dd>{compact(stat.value)}</dd>
							<dt>{stat.label}</dt>
						</div>
					))}
				</dl>
				{reactions > 0 && (
					<ul className="author-sheet-qualities" aria-label="What readers chose">
						{QUALITIES.map((q) => {
							const n = page.qualities[q.id] ?? 0;
							return (
								<li key={q.id} data-none={n === 0 || undefined}>
									<QualityIcon name={q.id} />
									<span className="author-quality-name">
										{q.label}
										<span className="author-quality-hint">{q.hint}</span>
									</span>
									<span className="author-quality-bar" aria-hidden="true">
										<span style={{ width: `${(n / most) * 100}%` }} />
									</span>
									<span className="author-quality-n">{n}</span>
								</li>
							);
						})}
					</ul>
				)}
				{page.since && <p className="author-sheet-since">Writing here since {monthYear(page.since)}.</p>}
			</div>
		</div>
	);
}
