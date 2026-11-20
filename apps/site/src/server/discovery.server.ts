import { ARCHIVE_KEEP, cacheHeaders, HOME_KEEP, keepAuthor } from "../lib/keep";
import { SITE } from "../lib/share";
import { monthCounts } from "./archive.server";
import { settledBefore } from "./feed.server";
import { renderMarkdown } from "./render";
import { db, marks } from "./rows.server";

// What feed readers and search engines read: the site's feed (/rss.xml),
// each author's (/@<handle>/rss.xml), both with whole posts, and the map
// of every page (/sitemap.xml). Addresses always point at the live site.

/** How many of the newest posts a feed carries. */
const FEED_LENGTH = 30;

type FeedRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string | null;
	markdown: string;
	html: string | null;
	published_at: string;
	updated_at: string;
	author_name: string;
	author_handle: string;
};

const escape = (text: string) =>
	text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);

/** Inside CDATA, everything is text except the sequence that ends it. */
const cdata = (html: string) => `<![CDATA[${html.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;

/** Links and pictures in a post point at the live site, since a feed reader shows them elsewhere. */
const absolute = (html: string, postUrl: string) =>
	html
		.replace(/(\s(?:src|href))="\/(?!\/)/g, `$1="${SITE.url}/`)
		.replace(/(\shref)="#/g, `$1="${postUrl}#`);

const rfc822 = (iso: string) => new Date(iso).toUTCString();

const postUrl = (row: { id: string; slug: string }) => `${SITE.url}/p/${row.id}/${row.slug}`;

/** The site's feed, or one author's (null when there's no such author). */
export async function feed(handle?: string): Promise<Response | null> {
	let author: { name: string; handle: string } | null = null;
	if (handle !== undefined) {
		author = await db().prepare("SELECT name, handle FROM authors WHERE handle = ?").bind(handle).first();
		if (!author) return null;
	}
	const { results: rows } = await db()
		.prepare(
			`SELECT p.id, p.slug, p.title, p.excerpt, p.markdown, p.html, p.published_at, p.updated_at,
			        a.name AS author_name, a.handle AS author_handle
			 FROM posts p JOIN authors a ON a.id = p.author_id
			 WHERE p.published_at <= ?1 ${author ? "AND a.handle = ?2" : ""}
			 ORDER BY p.published_at DESC, p.id DESC LIMIT ${FEED_LENGTH}`,
		)
		.bind(settledBefore(), ...(author ? [author.handle] : []))
		.all<FeedRow>();

	// Each post's P.S.es go at its end, as on its page.
	const ids = rows.map((row) => row.id);
	const postscripts = new Map<string, { body: string; html: string | null; created_at: string }[]>();
	if (ids.length) {
		const { results } = await db()
			.prepare(`SELECT post_id, body, html, created_at FROM postscripts WHERE post_id IN (${marks(ids)}) ORDER BY created_at`)
			.bind(...ids)
			.all<{ post_id: string; body: string; html: string | null; created_at: string }>();
		for (const ps of results) postscripts.set(ps.post_id, [...(postscripts.get(ps.post_id) ?? []), ps]);
	}

	const self = author ? `${SITE.url}/@${author.handle}/rss.xml` : `${SITE.url}/rss.xml`;
	const home = author ? `${SITE.url}/@${author.handle}` : SITE.url;
	const title = author ? `${author.name} · ${SITE.name}` : SITE.name;
	const description = author ? `Every post by ${author.name} on ${SITE.name}, written by a person.` : SITE.description;
	const latest = rows.reduce((at, row) => (row.updated_at > at ? row.updated_at : at), "");

	const items = rows.map((row) => {
		const url = postUrl(row);
		// The title is the item's own; the post's "# Title" isn't repeated under it.
		let html = (row.html ?? renderMarkdown(row.markdown)).replace(/<h1>[\s\S]*?<\/h1>\n?/, "");
		for (const ps of postscripts.get(row.id) ?? []) {
			const day = new Date(ps.created_at).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
			html += `\n<hr>\n<p><strong>P.S.</strong> <em>${escape(day)}</em></p>\n${ps.html ?? renderMarkdown(ps.body)}`;
		}
		return `
		<item>
			<title>${escape(row.title)}</title>
			<link>${escape(url)}</link>
			<guid isPermaLink="false">${escape(`${SITE.url}/p/${row.id}`)}</guid>
			<pubDate>${rfc822(row.published_at)}</pubDate>
			<dc:creator>${escape(row.author_name)}</dc:creator>
			${row.excerpt ? `<description>${escape(row.excerpt)}</description>` : ""}
			<content:encoded>${cdata(absolute(html, url))}</content:encoded>
		</item>`;
	});

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
	<channel>
		<title>${escape(title)}</title>
		<link>${escape(home)}</link>
		<description>${escape(description)}</description>
		<language>en</language>
		<atom:link href="${escape(self)}" rel="self" type="application/rss+xml"/>
		${latest ? `<lastBuildDate>${rfc822(latest)}</lastBuildDate>` : ""}${items.join("")}
	</channel>
</rss>
`;
	// Stored like the homepage, or like the author's page.
	const keep = author ? keepAuthor(author.handle) : HOME_KEEP;
	return xmlResponse(xml, "application/rss+xml; charset=utf-8", keep.tags, keep.seconds);
}

/**
 * The sitemap, in parts so none outgrows what search engines read (50,000
 * links a file): /sitemap.xml lists the parts; /sitemap/site.xml has the
 * site's own pages (the front pages, the archive's years and months);
 * /sitemap/2026-11.xml has that month's posts and their authors. Built from
 * the month counts (post_months) and one month's posts at a time, settled
 * posts only (as the archive): a month whose only post can still be fixed
 * isn't listed yet.
 */
/** The months with settled posts, newest first. */
const settledMonths = async () => [...(await monthCounts(settledBefore())).keys()];

export async function sitemapIndex(): Promise<Response> {
	const months = await settledMonths();
	const part = (name: string) => `\n\t<sitemap><loc>${escape(`${SITE.url}/sitemap/${name}.xml`)}</loc></sitemap>`;
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[part("site"), ...months.map(part)].join("")}
</sitemapindex>
`;
	return xmlResponse(xml, "application/xml; charset=utf-8", ARCHIVE_KEEP.tags, ARCHIVE_KEEP.seconds);
}

const url = (loc: string, lastmod?: string) => `\n\t<url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
const urlset = (urls: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}
</urlset>
`;

/** One part of the sitemap: "site", or a month ("2026-11"). Null when there's no such part. */
export async function sitemapPart(name: string): Promise<Response | null> {
	if (name === "site") {
		const months = await settledMonths();
		const years = [...new Set(months.map((month) => month.slice(0, 4)))];
		const xml = urlset([
			url(`${SITE.url}/`),
			url(`${SITE.url}/rules`),
			url(`${SITE.url}/archive`),
			...years.map((year) => url(`${SITE.url}/archive/${year}`)),
			...months.map((month) => url(`${SITE.url}/archive/${month.replace("-", "/")}`)),
		]);
		return xmlResponse(xml, "application/xml; charset=utf-8", ARCHIVE_KEEP.tags, ARCHIVE_KEEP.seconds);
	}
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(name)) return null;
	const [y, m] = [Number(name.slice(0, 4)), Number(name.slice(5, 7))];
	const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
	const { results } = await db()
		.prepare(
			`SELECT p.id, p.slug, p.updated_at, a.handle FROM posts p JOIN authors a ON a.id = p.author_id
			 WHERE p.published_at >= ?1 AND p.published_at < ?2 AND p.published_at <= ?3
			 ORDER BY p.published_at DESC`,
		)
		.bind(`${name}-01`, end, settledBefore())
		.all<{ id: string; slug: string; updated_at: string; handle: string }>();
	if (results.length === 0) return null;
	const xml = urlset([
		...results.map((row) => url(postUrl(row), row.updated_at)),
		// The authors who published that month (an author can be in several parts).
		...[...new Set(results.map((row) => row.handle))].map((handle) => url(`${SITE.url}/@${handle}`)),
	]);
	return xmlResponse(xml, "application/xml; charset=utf-8", ARCHIVE_KEEP.tags, ARCHIVE_KEEP.seconds);
}

/** Stored like the page they follow (lib/keep.ts): feeds like the homepage (readers poll them), the sitemap like the archive. */
const xmlResponse = (xml: string, type: string, tags: string[], seconds: number = HOME_KEEP.seconds) =>
	new Response(xml, {
		headers: {
			"content-type": type,
			...cacheHeaders({ seconds, tags }),
			"x-content-type-options": "nosniff",
		},
	});
