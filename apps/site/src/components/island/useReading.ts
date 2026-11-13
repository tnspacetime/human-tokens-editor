import { useEffect, useRef, useState } from "react";

const ISLAND_FOOT = 72;

// Reading a piece: once its heading has gone up under the island, `reading`
// turns on (the island shows the title), and the progress line's
// --progress runs from 0 to 1 as the article passes.
export function useReading(title: string | undefined) {
	const progress = useRef<HTMLSpanElement>(null);
	const [reading, setReading] = useState(false);

	useEffect(() => {
		setReading(false);
		if (!title) return;
		const article = document.querySelector<HTMLElement>(".post-body");
		if (!article) return;
		const heading = document.querySelector(".post-headline") ?? article.querySelector("h1") ?? article;
		let frame = 0;
		const update = () => {
			frame = 0;
			setReading(heading.getBoundingClientRect().bottom < ISLAND_FOOT);
			// From the article's top reaching the island to its end reaching
			// the bottom of the window.
			const rect = article.getBoundingClientRect();
			const travel = rect.height - innerHeight + ISLAND_FOOT;
			const done = travel <= 0 ? 1 : Math.min(1, Math.max(0, (ISLAND_FOOT - rect.top) / travel));
			progress.current?.style.setProperty("--progress", String(done));
		};
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		addEventListener("scroll", schedule, { passive: true });
		addEventListener("resize", schedule);
		return () => {
			cancelAnimationFrame(frame);
			removeEventListener("scroll", schedule);
			removeEventListener("resize", schedule);
		};
	}, [title]);

	return { reading, progress };
}
