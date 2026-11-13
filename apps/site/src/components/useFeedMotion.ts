import { type RefObject, useEffect } from "react";

// How the feed moves as you scroll: a tile below the first screen waits,
// faded and a little low, and rises into place as it comes into view; tiles
// in one row arrive a beat apart. Without JavaScript, or with Reduce Motion
// on, tiles are simply there.

const STAGGER_MS = 90;

// `count` is how many tiles are shown; when more load, the new ones join in.
export function useFeedMotion(list: RefObject<HTMLElement | null>, count: number) {
	useEffect(() => {
		const root = list.current;
		if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const tiles = Array.from(root.querySelectorAll<HTMLElement>(".tile"));

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

		return () => {
			arrive.disconnect();
			for (const tile of tiles) {
				if (tile.dataset.enter === "wait") delete tile.dataset.enter;
			}
		};
	}, [list, count]);
}
