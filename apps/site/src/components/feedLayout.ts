import type { FeedItem } from "../lib/types";
import type { TileSize } from "./PostCard";

const DAY = 86_400_000;

export type FeedSection = { key: string; label: string; posts: FeedItem[] };

// The feed in stretches of time, newest first: this week, last week, then
// one stretch per month ("October", "December 2025"), so a long scroll has
// landmarks. `now` comes from the server with the first page, so the page
// renders the same on both sides. Dates are read in UTC, like the tiles'.
export function feedSections(posts: FeedItem[], now: number): FeedSection[] {
	const year = new Date(now).getUTCFullYear();
	const sections: FeedSection[] = [];
	for (const post of posts) {
		const at = Date.parse(post.publishedAt);
		const date = new Date(at);
		const age = now - at;
		const { key, label } =
			age < 7 * DAY
				? { key: "this-week", label: "This week" }
				: age < 14 * DAY
					? { key: "last-week", label: "Last week" }
					: {
							key: `${date.getUTCFullYear()}-${date.getUTCMonth()}`,
							label: date.toLocaleDateString("en", {
								month: "long",
								...(date.getUTCFullYear() === year ? {} : { year: "numeric" }),
								timeZone: "UTC",
							}),
						};
		const last = sections.at(-1);
		if (last?.key === key) last.posts.push(post);
		else sections.push({ key, label, posts: [post] });
	}
	return sections;
}

// How wide each tile in a section is. The newest piece of all leads across
// the full width; every section then opens with a pair, and in a long one
// a pair comes back after every four rows of three, so the rhythm changes
// as you scroll. Once a section is complete, its last row is never left
// half empty: a lone third joins the pair before it as a row of three, two
// thirds become a pair, four become two pairs, and a piece on its own goes
// full width. (Not while the section can still grow, or tiles would change
// size when the next page arrives.)
const CYCLE = 2 + 12;

export function sectionSizes(count: number, lead: boolean, complete: boolean): TileSize[] {
	const sizes: TileSize[] = [];
	let at = 0;
	for (let i = 0; i < count; i++) {
		if (lead && i === 0) sizes.push("hero");
		else sizes.push(at++ % CYCLE < 2 ? "half" : "third");
	}
	if (!complete) return sizes;

	let thirds = 0;
	while (thirds < sizes.length && sizes[sizes.length - 1 - thirds] === "third") thirds++;
	const end = sizes.length;
	if (thirds % 3 === 2) {
		sizes.fill("half", end - 2);
	} else if (thirds % 3 === 1) {
		if (thirds >= 4) sizes.fill("half", end - 4);
		else if (sizes[end - 2] === "half" && sizes[end - 3] === "half") sizes.fill("third", end - 3);
		else sizes[end - 1] = "hero";
	} else if (thirds === 0) {
		let halves = 0;
		while (halves < sizes.length && sizes[sizes.length - 1 - halves] === "half") halves++;
		if (halves % 2 === 1) sizes[end - 1] = "hero";
	}
	return sizes;
}
