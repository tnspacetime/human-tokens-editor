// What a page says about itself to search engines and to the apps a link is
// shared in (iMessage, Slack, X, LinkedIn…): its title, a line about it,
// its one address, and a picture. Each page's head() calls share(); the
// site-wide defaults (the picture, the icons) are in __root.tsx.

export const SITE = {
	name: "Human Tokens",
	/** The live address. Shared links and canonical addresses always point here, even while developing. */
	url: "https://human-tokens.dev",
	description: "Writing by people. Your ideas, your thoughts, in your own words.",
	/** The picture shared links show (public/og.png, made by brand/make.sh). */
	image: { path: "/og.png", width: 1200, height: 630, alt: "Human Tokens: writing by people. Your ideas, your thoughts, in your own words." },
} as const;

type Meta = Record<string, string>;

export function share({
	title,
	description = SITE.description,
	path,
	type = "website",
	article,
}: {
	/** The page's own name, without the site's: "The rules", a piece's title. Omit on the homepage. */
	title?: string;
	description?: string;
	/** The page's address on the site, like /rules. */
	path: string;
	type?: "website" | "article" | "profile";
	article?: { publishedAt: string; authorPath: string };
}): { meta: Meta[]; links: Meta[] } {
	const url = SITE.url + path;
	const meta: Meta[] = [
		{ title: title ? `${title} · ${SITE.name}` : SITE.name },
		{ name: "description", content: description },
		{ property: "og:title", content: title ?? SITE.name },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:type", content: type },
	];
	if (article) {
		meta.push(
			{ property: "article:published_time", content: article.publishedAt },
			{ property: "article:author", content: SITE.url + article.authorPath },
		);
	}
	return { meta, links: [{ rel: "canonical", href: url }] };
}

/** For the site's root: the parts every page shares (the picture, the kind of card, the site's name). */
export const SHARED_META: Meta[] = [
	{ property: "og:site_name", content: SITE.name },
	{ property: "og:locale", content: "en_US" },
	{ property: "og:image", content: SITE.url + SITE.image.path },
	{ property: "og:image:width", content: String(SITE.image.width) },
	{ property: "og:image:height", content: String(SITE.image.height) },
	{ property: "og:image:alt", content: SITE.image.alt },
	// X reads og: for the title, line and picture; this asks for the large picture.
	{ name: "twitter:card", content: "summary_large_image" },
];
