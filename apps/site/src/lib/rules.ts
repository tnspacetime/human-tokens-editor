// The rules of Human Tokens: about the writing and its pictures, and
// nothing else. Shown on the homepage and on /rules; Fold MD's "I wrote
// this myself" pledge at publish points here too. Change the wording here
// and it changes everywhere.
export const RULES = [
	{ title: "Every word is yours.", line: "No AI wrote any of it." },
	{ title: "So is the shaping.", line: "The writing and every edit are yours." },
	{ title: "Pictures too.", line: "Yours, or free to share. None made by AI." },
	{ title: "Rough edges are human.", line: "People have always understood each other through them." },
	{ title: "Write anything, for any reason.", line: "What it's worth is for readers to decide." },
	{ title: "It runs on trust.", line: "Nobody checks your work. We take your word for it, and you keep it." },
] as const;

// Under the rules on /rules: how a piece lives here once it's published,
// for readers who meet a "Follows…", a reply or a P.S. The numbers are the
// site's own (publish.server.ts: FIX_WINDOW_MINUTES, PUBLISH_LIMIT and
// LIMIT_DAYS): change them together.
export const HOW_IT_WORKS = [
	{ title: "Words settle.", line: "You can fix a post for 15 minutes, until someone reacts or comments. After that it stays as they read it." },
	{ title: "Add, don't rewrite.", line: "A P.S. adds a short, dated note at the end. A follow-up is a new post that points back." },
	{ title: "Answer in writing.", line: "To answer someone, write a post in reply. It follows the same rules, and it's listed under theirs." },
	{ title: "Fifty a month.", line: "Up to 50 new posts in 30 days: enough to write every day, not enough to flood." },
	{ title: "Yours to take down.", line: "Delete a post whenever you like. Its reactions and comments go with it." },
] as const;
