import { SITE } from "../lib/share";
import { renderer } from "./posts.server";
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
			`SELECT p.id, p.slug, p.title, p.excerpt, p.markdown, p.published_at, p.updated_at,
			        a.name AS author_name, a.handle AS author_handle
			 FROM posts p JOIN authors a ON a.id = p.author_id
			 ${author ? "WHERE a.handle = ?" : ""}
			 ORDER BY p.published_at DESC, p.id DESC LIMIT ${FEED_LENGTH}`,
		)
		.bind(...(author ? [author.handle] : []))
		.all<FeedRow>();

	// Each post's P.S.es go at its end, as on its page.
	const ids = rows.map((row) => row.id);
	const postscripts = new Map<string, { body: string; created_at: string }[]>();
	if (ids.length) {
		const { results } = await db()
			.prepare(`SELECT post_id, body, created_at FROM postscripts WHERE post_id IN (${marks(ids)}) ORDER BY created_at`)
			.bind(...ids)
			.all<{ post_id: string; body: string; created_at: string }>();
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
		let html = renderer.render(row.markdown).replace(/<h1>[\s\S]*?<\/h1>\n?/, "");
		for (const ps of postscripts.get(row.id) ?? []) {
			const day = new Date(ps.created_at).toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
			html += `\n<hr>\n<p><strong>P.S.</strong> <em>${escape(day)}</em></p>\n${renderer.render(ps.body)}`;
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
	return xmlResponse(xml, "application/rss+xml; charset=utf-8");
}

/** Every page worth finding: the front pages, each year of the archive, each author, each post. */
export async function sitemap(): Promise<Response> {
	const [posts, authors, years] = await db().batch<Record<string, string>>([
		db().prepare("SELECT id, slug, updated_at FROM posts ORDER BY published_at DESC"),
		db().prepare(
			`SELECT a.handle, MAX(p.updated_at) AS updated_at FROM authors a JOIN posts p ON p.author_id = a.id
			 GROUP BY a.id ORDER BY a.handle`,
		),
		db().prepare("SELECT DISTINCT substr(published_at, 1, 4) AS year FROM posts ORDER BY year DESC"),
	]);
	const latest = posts.results[0] ? posts.results.reduce((at, row) => (row.updated_at > at ? row.updated_at : at), "") : undefined;
	const url = (loc: string, lastmod?: string) =>
		`\n\t<url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[
		url(`${SITE.url}/`, latest),
		url(`${SITE.url}/rules`),
		url(`${SITE.url}/archive`, latest),
		...years.results.map((row) => url(`${SITE.url}/archive/${row.year}`)),
		...authors.results.map((row) => url(`${SITE.url}/@${row.handle}`, row.updated_at)),
		...posts.results.map((row) => url(postUrl({ id: row.id, slug: row.slug }), row.updated_at)),
	].join("")}
</urlset>
`;
	return xmlResponse(xml, "application/xml; charset=utf-8");
}

const xmlResponse = (xml: string, type: string) =>
	new Response(xml, {
		headers: {
			"content-type": type,
			// Readers poll feeds; a few minutes' delay is fine.
			"cache-control": "public, max-age=300",
			"x-content-type-options": "nosniff",
		},
	});
