import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { FOLD_MD } from "../lib/editor";
import { share } from "../lib/share";

// Where the island's Write leads: an invitation to write here, which means
// writing in Fold MD on your Mac and publishing from it.
export const Route = createFileRoute("/write")({
	head: () =>
		share({
			title: "Write",
			description: "Write in Fold MD, a quiet markdown editor for the Mac, and publish here when it's ready.",
			path: "/write",
		}),
	component: WritePage,
});

const STEPS = [
	{
		title: "Write in plain text.",
		line: "Markdown, in a native Mac editor that stays out of your way. Your files stay on your Mac.",
	},
	{
		title: "See it as it will read.",
		line: "A sheet folds down with your words set: math, code and images. The published page folds out beside you.",
	},
	{
		title: "Publish on your word.",
		line: "When it's ready, publish from the editor and promise you wrote it yourself.",
	},
] as const;

function WritePage() {
	return (
		<main className="write-page">
			<section className="write-hero">
				<img className="write-icon" src="/fold-md.png" width={128} height={128} alt="" />
				<p className="write-eyebrow">Fold MD for Mac</p>
				<h1>Write it yourself.</h1>
				<p className="write-intro">
					Posts here are written and published from Fold MD, a quiet markdown editor for the Mac built on
					the Fold pattern: your words set as you write them, in a sheet that folds down over the page.
					Write there, and publish here when it's ready.
				</p>
				<Download />
			</section>

			<Demo />

			<ol className="write-steps">
				{STEPS.map((step, index) => (
					<li key={step.title}>
						<span className="write-step-number" aria-hidden="true">
							{index + 1}
						</span>
						<p className="write-step-title">{step.title}</p>
						<p className="write-step-line">{step.line}</p>
					</li>
				))}
			</ol>

			<Features />

			<p className="write-links">
				<Link to="/rules">The rules</Link>
				<Link to="/">Read what people wrote</Link>
			</p>
		</main>
	);
}

// Fold MD in use, recorded from the app itself (apps/editor/design/demo).
// Each browser takes the first it can play: AV1 (Chrome, Firefox, newer
// Macs), then HEVC (Safari), then H.264 (anything).
const DEMO = {
	sources: [
		{ src: "/video/fold-md.av1.mp4", type: 'video/mp4; codecs="av01.0.12M.08"' },
		{ src: "/video/fold-md.hevc.mp4", type: 'video/mp4; codecs="hvc1.1.6.L150.B0"' },
		{ src: "/video/fold-md.h264.mp4", type: 'video/mp4; codecs="avc1.640032"' },
	],
	poster: "/video/fold-md-poster.webp",
	label: "Fold MD in use: writing maths in plain text, the sheet showing it set, and the published page folding out beside it.",
} as const;

/**
 * The demo plays, silently and on a loop, once it's in view, and pauses
 * when it's scrolled away. The controls are always there; once you pause
 * it yourself, it stays paused. With Reduce Motion on it waits for Play.
 */
function Demo() {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const video = ref.current;
		if (!video || typeof IntersectionObserver === "undefined") return;
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let started = false;
		let pausedForScroll = false;
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					if (!started && !still) {
						started = true;
						video.play().catch(() => {});
					} else if (pausedForScroll) {
						pausedForScroll = false;
						video.play().catch(() => {});
					}
				} else if (!video.paused) {
					pausedForScroll = true;
					video.pause();
				}
			},
			{ threshold: 0.4 },
		);
		observer.observe(video);
		return () => observer.disconnect();
	}, []);
	return (
		<figure className="write-demo">
			<video
				ref={ref}
				className="write-demo-video"
				width={2560}
				height={1440}
				poster={DEMO.poster}
				aria-label={DEMO.label}
				muted
				loop
				playsInline
				controls
				preload="metadata"
			>
				{DEMO.sources.map((source) => (
					<source key={source.src} src={source.src} type={source.type} />
				))}
			</video>
		</figure>
	);
}

// What Fold MD does, each with a screenshot from the app itself
// (apps/editor/design/shots: shoot.sh takes them, make-web.sh sizes them).
// The root README.md repeats these words and STEPS: change both together.
// Most are the window alone, 4:3, beside their words, alternating sides;
// the wide ones (the page out beside the writing) get the page's width.
type Feature = {
	shot: string;
	title: string;
	line: string;
	alt: string;
	wide?: boolean;
};

const FEATURES: Feature[] = [
	{
		shot: "under",
		title: "Scroll under the sheet.",
		line: "What you've scrolled past slides under the sheet at the top and comes back set: maths, code and pictures as they'll read. Drag its edge down for more.",
		alt: "Fold MD with the sheet open at the top, showing the paragraphs above the writing set as they'll read, with their maths.",
	},
	{
		shot: "focus",
		title: "Or just the paragraph you're on.",
		line: "Switch the sheet to the current paragraph and it sets only what you're writing, as you type it. Good for a long formula or a table.",
		alt: "The sheet showing only the formula the cursor is in, set, with the text around it faded.",
	},
	{
		shot: "maths",
		title: "Plain text, quietly coloured.",
		line: "Close the sheet and it's just your words. Maths and code are coloured as you type them, and the spell checker leaves them alone.",
		alt: "Fold MD with the sheet closed: plain markdown, with the maths in a soft teal.",
	},
	{
		shot: "notes",
		title: "Notes to yourself.",
		line: "Select a phrase and leave yourself a note in the margin. Notes stay on your Mac and are never published.",
		alt: "A phrase highlighted in the writing, with a note beside it in the margin: Jakob or Johann? Check before publishing.",
	},
	{
		shot: "page",
		title: "The page, beside you.",
		line: "The published page folds out to the right, as readers will see it, and keeps to where you're writing.",
		alt: "Fold MD with the published page folded out beside the writing, both at the same paragraph.",
		wide: true,
	},
	{
		shot: "series",
		title: "Series.",
		line: "Put documents in order as a series, without moving any files. It's published whole, each part a chapter.",
		alt: "The series sidebar open on the left, listing three parts in order, with the first part open.",
	},
	{
		shot: "publish",
		title: "Published from the editor.",
		line: "See how it starts in the feed, promise you wrote it yourself, and publish. For 15 minutes after, you can still fix it.",
		alt: "The publish sheet: how the post starts in the feed, the box for I wrote this myself, and the Publish button.",
	},
	{
		shot: "dark",
		title: "Light or dark.",
		line: "The writing, the sheet and the page all follow. Sun or moon, in the toolbar.",
		alt: "Fold MD in dark mode, with the page folded out beside the writing.",
		wide: true,
	},
];

function Features() {
	return (
		<section className="write-features" aria-labelledby="write-features-title">
			<h2 id="write-features-title" className="write-features-title">
				What it does
			</h2>
			{FEATURES.map((feature) => {
				const [large, small] = feature.wide ? [2560, 1280] : [1600, 800];
				return (
					<figure key={feature.shot} className={feature.wide ? "write-feature is-wide" : "write-feature"}>
						<img
							className="write-feature-shot"
							src={`/shots/${feature.shot}-${large}.webp`}
							srcSet={`/shots/${feature.shot}-${small}.webp ${small}w, /shots/${feature.shot}-${large}.webp ${large}w`}
							sizes={feature.wide ? "(max-width: 1028px) 100vw, 980px" : "(max-width: 734px) 100vw, 560px"}
							width={large}
							height={feature.wide ? (large * 9) / 16 : (large * 3) / 4}
							alt={feature.alt}
							loading="lazy"
							decoding="async"
						/>
						<figcaption className="write-feature-words">
							<p className="write-feature-title">{feature.title}</p>
							<p className="write-feature-line">{feature.line}</p>
						</figcaption>
					</figure>
				);
			})}
		</section>
	);
}

function Download() {
	const icon = (
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />
		</svg>
	);
	return (
		<div className="write-download">
			{FOLD_MD.released ? (
				<a className="write-button" href={FOLD_MD.download}>
					{icon}
					Download for Mac
				</a>
			) : (
				<button type="button" className="write-button" disabled>
					{icon}
					Download for Mac
				</button>
			)}
			<p className="write-fine">
				{FOLD_MD.released ? FOLD_MD.requires : `Coming soon · for ${FOLD_MD.requires}`}
			</p>
		</div>
	);
}
