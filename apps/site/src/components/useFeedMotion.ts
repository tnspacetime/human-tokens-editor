import { type RefObject, useEffect } from "react";

// How the feed moves as you scroll.
//
// Arriving: a tile below the first screen waits, faded and a little low,
// and rises into place as it comes into view; tiles in one row arrive a beat
// apart, and each one's page drawing sketches itself in as it lands. Without
// JavaScript, or with Reduce Motion on, tiles are simply there.
//
// Unfolding on a touch screen, where nothing can be hovered: like the
// editor's "Current paragraph" sheet, the tile resting nearest the middle of
// the screen unfolds into its opening words, and folds back as you move on.
// On a computer the pointer does that instead (hover, in the CSS).

const STAGGER_MS = 90;
const SETTLE_MS = 140;

// `count` is how many tiles are shown; when more load, the new ones join in.
export function useFeedMotion(list: RefObject<HTMLElement | null>, count: number) {
	useEffect(() => {
		const root = list.current;
		if (!root) return;
		const tiles = Array.from(root.querySelectorAll<HTMLElement>(".tile"));
		const cleanups: (() => void)[] = [];

		if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
			// Each tile arrives once: those on screen (or already arrived, when
			// more tiles load) are marked seen and left alone.
			const waiting = tiles.filter(
				(tile) => tile.dataset.seen === undefined && tile.getBoundingClientRect().top > innerHeight - 40,
			);
			for (const tile of tiles) if (!waiting.includes(tile)) tile.dataset.seen = "";
			for (const tile of waiting) tile.dataset.enter = "wait";
			const arrive = new IntersectionObserver(
				(entries) => {
					const arriving = entries
						.filter((entry) => entry.isIntersecting)
						.map((entry) => entry.target as HTMLElement)
						.sort((a, b) => {
							const ra = a.getBoundingClientRect();
							const rb = b.getBoundingClientRect();
							return ra.top - rb.top || ra.left - rb.left;
						});
					arriving.forEach((tile, order) => {
						tile.style.setProperty("--enter-delay", `${order * STAGGER_MS}ms`);
						tile.dataset.enter = "in";
						tile.dataset.seen = "";
						arrive.unobserve(tile);
					});
				},
				{ rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
			);
			for (const tile of waiting) arrive.observe(tile);
			cleanups.push(() => arrive.disconnect());
		}

		if (matchMedia("(hover: none)").matches) {
			let open: HTMLElement | null = null;
			let settle = 0;
			const inBand = (tile: HTMLElement) => {
				const cover = tile.querySelector(".tile-cover")?.getBoundingClientRect();
				if (!cover) return Number.POSITIVE_INFINITY;
				const middle = cover.top + cover.height / 2;
				const target = innerHeight * 0.45;
				return middle > innerHeight * 0.2 && middle < innerHeight * 0.72 ? Math.abs(middle - target) : Number.POSITIVE_INFINITY;
			};
			const choose = () => {
				let best: HTMLElement | null = null;
				let distance = Number.POSITIVE_INFINITY;
				for (const tile of tiles) {
					const d = inBand(tile);
					if (d < distance) {
						best = tile;
						distance = d;
					}
				}
				if (best === open) return;
				if (open) delete open.dataset.unfold;
				open = best;
				if (open) open.dataset.unfold = "";
			};
			// While you're moving, a tile that leaves the middle folds at once;
			// the next one unfolds when you pause on it.
			const onScroll = () => {
				if (open && inBand(open) === Number.POSITIVE_INFINITY) {
					delete open.dataset.unfold;
					open = null;
				}
				clearTimeout(settle);
				settle = window.setTimeout(choose, SETTLE_MS);
			};
			addEventListener("scroll", onScroll, { passive: true });
			settle = window.setTimeout(choose, 600);
			cleanups.push(() => {
				removeEventListener("scroll", onScroll);
				clearTimeout(settle);
				if (open) delete open.dataset.unfold;
			});
		}

		return () => {
			for (const cleanup of cleanups) cleanup();
			for (const tile of tiles) {
				if (tile.dataset.enter === "wait") delete tile.dataset.enter;
			}
		};
	}, [list, count]);
}
