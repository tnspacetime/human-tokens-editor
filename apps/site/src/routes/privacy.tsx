import { createFileRoute, Link } from "@tanstack/react-router";
import { RuleList } from "../components/Rules";
import { share } from "../lib/share";

// What the site keeps about people, and why: linked from the footer and from
// Google's sign-in screen (its consent screen needs a privacy policy). Keep it
// true to the code: users, sessions and accounts (migrations/0004), device
// codes (0005), the theme cookie (lib/theme.ts), the writer's draft
// (components/writer/draft.ts), cleanup.server.ts.

const CONTACT = "human-tokens@googlegroups.com";
const UPDATED = "21 November 2026";

const KEPT = [
	{ title: "Reading needs nothing.", line: "Every post can be read without an account, and nothing here records what you read." },
	{
		title: "Who you are, when you sign in.",
		line: "Your name, email address and profile picture, from Google or GitHub. Your name and picture show beside what you write; your email address is never shown.",
	},
	{
		title: "Staying signed in.",
		line: "A cookie, and a record of the sign-in with your browser's name and IP address. It goes when you sign out, or 30 days after you last visit.",
	},
	{
		title: "What you do here.",
		line: "Your reactions and comments, and if you write, your posts, P.S.es and pictures. Posts and comments are public; that's what they're for.",
	},
	{
		title: "Fold MD.",
		line: "If you connect Fold MD, the name of each Mac it's connected on, so you can disconnect one. Fold MD also asks GitHub, where it's released, when it opens and once a day, whether there's a newer version: the question carries nothing about you.",
	},
	{ title: "Light or dark.", line: "If you choose a theme, a cookie remembers it. Nothing else is in it." },
] as const;

const NOT = [
	{ title: "No ads, no tracking, no analytics.", line: "Nothing about you is sold or shared with anyone." },
	{
		title: "Drafts stay in your browser.",
		line: "What you write in the browser is kept in your browser until you publish it. The site doesn't see it before then.",
	},
	{
		title: "Google and GitHub only say who you are.",
		line: "The site asks them for your name, email address and picture, and never reads or posts anything there.",
	},
	{
		title: "Cloudflare runs the site.",
		line: "It stores the database and pictures, and keeps short-lived logs of requests to keep the site working and safe.",
	},
] as const;

const YOURS = [
	{ title: "Take a post down.", line: "Delete any post of yours whenever you like. Its reactions, comments and P.S.es go with it." },
	{
		title: "Delete your account.",
		line: `Write to ${CONTACT} from the email address you sign in with, and your account goes, with everything you wrote here.`,
	},
	{ title: "If this changes,", line: "the date at the top changes too." },
] as const;

export const Route = createFileRoute("/privacy")({
	head: () => share({ title: "Privacy", description: "What Human Tokens keeps about you, and why.", path: "/privacy" }),
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<main className="rules-page">
			<p className="rules-eyebrow">Human Tokens · {UPDATED}</p>
			<h1>Privacy</h1>
			<p className="rules-intro">What the site keeps about you, and why. It keeps little.</p>
			<RuleList large plain items={KEPT} />
			<h2 className="rules-section">What it doesn't do</h2>
			<RuleList large plain items={NOT} />
			<h2 className="rules-section">Yours to decide</h2>
			<RuleList large plain items={YOURS} />
			<p className="rules-back">
				<Link to="/">Read what people wrote</Link>
			</p>
		</main>
	);
}
