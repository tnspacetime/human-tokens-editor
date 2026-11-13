import type { TileSize } from "./PostCard";

// How wide each tile on the homepage is, as one continuous flow. The newest
// piece leads across the full width, then a pair, then four rows of three,
// and a pair again after every four rows, so the rhythm changes as you
// scroll. The last row is never left half empty: a lone third joins the
// pair before it as a row of three, two thirds become a pair, four become
// two pairs, and a piece on its own goes full width. (Only once the flow is
// complete: while more can still load, tiles would change size under you.)
const CYCLE = 2 + 12;

export function tileSizes(count: number, complete: boolean): TileSize[] {
	const sizes: TileSize[] = [];
	for (let i = 0; i < count; i++) {
		sizes.push(i === 0 ? "hero" : (i - 1) % CYCLE < 2 ? "half" : "third");
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
