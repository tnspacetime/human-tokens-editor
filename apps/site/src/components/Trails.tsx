import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDeleted } from "../lib/deleted";
import type { Trail, TrailPeriod, TrailPost, Trails } from "../lib/types";

// The replies readers chose most, each with the trail of posts it answers:
// the opening post, any replies between, then the reply itself. Week,
// Month or All time, worked out with the ranking (server/ranking.server.ts).
// The votes are the reply's own; the posts before it are there so you can
// see what it answers. A long conversation shows its opening post, how many
// are left out, then its last two (lib/trails.ts).

const PERIODS: { id: TrailPeriod; short: string; title: string }[] = [
	{ id: "week", short: "Week", title: "This week’s conversations" },
	{ id: "month", short: "Month", title: "This month’s conversations" },
	{ id: "all", short: "All time", title: "Conversations of all time" },
];

const EMPTY: Record<TrailPeriod, string> = {
	week: "No reply has been voted for this week yet.",
	month: "No reply has been voted for this month yet.",
	all: "No reply has been voted for yet.",
};

/**
 * Nothing at all (no reply has votes yet): no board. Otherwise it opens on
 * the first period with something in it, and a period with nothing says so.
 */
export function TrailsBoard({ trails: stored }: { trails: Trails }) {
	// Less any trail with a post you've just deleted (lib/deleted.ts).
	const deleted = useDeleted();
	const trails = useMemo(() => (deleted.size ? without(stored, deleted) : stored), [stored, deleted]);
	const first = PERIODS.find((p) => trails[p.id].length > 0)?.id;
	const [chosen, setPeriod] = useState<TrailPeriod | null>(null);
	if (!first) return null;
	const period = chosen ?? first;
	const at = PERIODS.findIndex((p) => p.id === period);
	const shown = trails[period];
	const most = shown[0]?.votes ?? 1;
	return (
		<section className="trails" aria-labelledby="trails-title">
			<header className="section-head">
				<div className="ranking-title">
					<h2 id="trails-title">{PERIODS[at].title}</h2>
					<p>The replies readers chose most, and what they answer</p>
				</div>
				<div className="window-switch" role="radiogroup" aria-label="Period" style={{ ["--at" as string]: at }}>
					<span className="window-thumb" aria-hidden="true" />
					{PERIODS.map((p) => (
						<button key={p.id} type="button" role="radio" aria-checked={p.id === period} onClick={() => setPeriod(p.id)}>
							{p.short}
						</button>
					))}
				</div>
			</header>
			{shown.length === 0 ? (
				<p className="trails-panel trails-empty">{EMPTY[period]}</p>
			) : (
				<ol className="trails-panel" key={period}>
					{shown.map((trail, rank) => (
						<TrailRow key={trail.posts.at(-1)?.id} trail={trail} rank={rank} share={trail.votes / most} />
					))}
				</ol>
			)}
		</section>
	);
}

function without(trails: Trails, deleted: ReadonlySet<string>): Trails {
	const keep = (list: Trail[]) => list.filter((trail) => !trail.posts.some((post) => deleted.has(post.id)));
	return { week: keep(trails.week), month: keep(trails.month), all: keep(trails.all) };
}

function TrailRow({ trail, rank, share }: { trail: Trail; rank: number; share: number }) {
	const { posts, more } = trail;
	const steps: (TrailPost | number)[] = more ? [posts[0], more, ...posts.slice(1)] : posts;
	const reply = posts.at(-1);
	return (
		<li className="trail" style={{ ["--rank" as string]: rank }}>
			<span className="board-rank">{rank + 1}</span>
			<ol className="trail-steps" aria-label={`${posts.length + more} posts, ending with the reply by ${reply?.author}`}>
				{steps.map((step, i) =>
					typeof step === "number" ? (
						<li key="more" className="trail-more">
							<span className="trail-more-count">{step} more</span>
							<svg className="trail-arrow" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M3 8h10M9 4l4 4-4 4" />
							</svg>
						</li>
					) : (
						<li key={step.id} className={step === reply ? "trail-step is-reply" : "trail-step"}>
							<Link to="/p/$id/$slug" params={{ id: step.id, slug: step.slug }}>
								<span className="trail-title">{step.title}</span>
								<span className="trail-author">{step.author}</span>
							</Link>
							{i < steps.length - 1 && (
								<svg className="trail-arrow" viewBox="0 0 16 16" aria-hidden="true">
									<path d="M3 8h10M9 4l4 4-4 4" />
								</svg>
							)}
						</li>
					),
				)}
			</ol>
			<span className="trail-votes">
				<span className="board-bar" style={{ ["--share" as string]: share }} />
				<span className="board-votes">{trail.votes.toLocaleString("en")}</span>
			</span>
		</li>
	);
}
