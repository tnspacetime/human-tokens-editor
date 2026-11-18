import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "./useDismiss";

type Chapter = { id: string; title: string };

// A series published as one piece: a small island floating at the foot of
// the page says which part you're in, and slides the list of parts up to
// jump to another.
export function SeriesIsland({ chapters }: { chapters: Chapter[] }) {
	const [open, setOpen] = useState(false);
	const [current, setCurrent] = useState(-1);
	const dock = useRef<HTMLDivElement>(null);
	const close = useCallback(() => setOpen(false), []);
	useDismiss(open, dock, close);

	// The part you're in: the last one whose heading has passed the upper
	// third of the window.
	useEffect(() => {
		const headings = chapters.map((c) => document.getElementById(c.id)).filter((h) => h !== null);
		let frame = 0;
		const update = () => {
			frame = 0;
			const line = window.innerHeight / 3;
			let index = -1;
			headings.forEach((heading, i) => {
				if (heading.getBoundingClientRect().top <= line) index = i;
			});
			setCurrent(index);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(update);
		};
		update();
		addEventListener("scroll", onScroll, { passive: true });
		addEventListener("resize", onScroll);
		return () => {
			removeEventListener("scroll", onScroll);
			removeEventListener("resize", onScroll);
			cancelAnimationFrame(frame);
		};
	}, [chapters]);

	const go = (chapter: Chapter) => {
		setOpen(false);
		document.getElementById(chapter.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
		history.replaceState(null, "", `#${chapter.id}`);
	};

	const here = chapters[current];
	return (
		<div ref={dock} className="series-dock">
			<nav id="series-parts" className="series-panel" data-open={open || undefined} inert={!open} aria-label="Parts">
				<p className="series-panel-label">A series in {chapters.length} parts</p>
				<ol>
					{chapters.map((chapter, i) => (
						<li key={chapter.id}>
							<button
								type="button"
								className="series-part"
								aria-current={i === current ? "location" : undefined}
								onClick={() => go(chapter)}
							>
								<span className="series-part-number">{i + 1}</span>
								{chapter.title}
							</button>
						</li>
					))}
				</ol>
			</nav>
			<button
				type="button"
				className="series-island"
				aria-expanded={open}
				aria-controls="series-parts"
				onClick={() => setOpen(!open)}
			>
				<span className="series-island-count">{here ? `${current + 1} / ${chapters.length}` : `${chapters.length} parts`}</span>
				<span className="series-island-title">{here ? here.title : "Contents"}</span>
				<svg className="series-island-chevron" viewBox="0 0 12 12" aria-hidden="true">
					<path d="M3 7.5 6 4.5l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
		</div>
	);
}
