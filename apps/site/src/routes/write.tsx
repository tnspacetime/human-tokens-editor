import { createFileRoute, Link } from "@tanstack/react-router";
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
					Posts here are written and published from Fold MD, a quiet markdown editor for the Mac. Write
					there, and publish here when it's ready.
				</p>
				<Download />
			</section>

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

			<p className="write-links">
				<Link to="/rules">The rules</Link>
				<Link to="/">Read what people wrote</Link>
			</p>
		</main>
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
			{FOLD_MD.download ? (
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
				{FOLD_MD.download ? FOLD_MD.requires : `Coming soon · for ${FOLD_MD.requires}`}
			</p>
		</div>
	);
}
