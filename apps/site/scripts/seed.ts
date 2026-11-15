// Builds .seed.sql from seed/seed.json and seed/posts/*.md, then
// `bun run db:seed` loads it into the local D1 database. Safe to re-run:
// it clears the tables first. Post ids come from the file name, so links
// stay the same across re-seeds.
//
// Readers and commenters here are users with no way to sign in (no account,
// a placeholder address). The authors
// aren't linked to anyone: on localhost, the dev sign-in "as an author"
// links you to one. Re-seeding signs everyone out.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveFromMarkdown } from "../src/server/derive";

type Seed = {
	authors: { id: string; handle: string; name: string; bio: string }[];
	posts: { file: string; author: string; publishedAt: string; allowDebate?: boolean }[];
	reactions: { file: string; qualities: Record<string, number> }[];
	comments: { file: string; name: string; body: string; authorNote?: string }[];
};

const root = new URL("..", import.meta.url).pathname;
const seed: Seed = JSON.parse(readFileSync(`${root}seed/seed.json`, "utf8"));

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const idFor = (text: string, length = 8) =>
	[...createHash("sha256").update(text).digest()].slice(0, length).map((b) => alphabet[b % 62]).join("");
const q = (value: unknown) => (value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const slugify = (title: string) =>
	title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const sql: string[] = [
	"DELETE FROM comments;",
	"DELETE FROM reactions;",
	"DELETE FROM posts;",
	"DELETE FROM authors;",
	"DELETE FROM sessions;",
	"DELETE FROM accounts;",
	"DELETE FROM users;",
];
const seeded = new Date().toISOString();
const users = new Set<string>();
const addUser = (id: string, name: string) => {
	if (users.has(id)) return;
	users.add(id);
	sql.push(
		`INSERT INTO users (id, name, email, created_at, updated_at) VALUES (${q(id)}, ${q(name)}, ${q(`${id}@seed.invalid`)}, ${q(seeded)}, ${q(seeded)});`,
	);
};

for (const a of seed.authors) {
	sql.push(`INSERT INTO authors (id, handle, name, bio) VALUES (${q(a.id)}, ${q(a.handle)}, ${q(a.name)}, ${q(a.bio)});`);
}

const postIds = new Map<string, string>();
for (const p of seed.posts) {
	const markdown = readFileSync(`${root}seed/posts/${p.file}`, "utf8");
	const derived = deriveFromMarkdown(markdown);
	const id = idFor(p.file);
	postIds.set(p.file, id);
	const name = derived.title ?? p.file.replace(/\.md$/, "");
	sql.push(
		`INSERT INTO posts (id, author_id, slug, title, excerpt, markdown, word_count, shape, opening, allow_debate, published_at, updated_at) VALUES (${q(id)}, ${q(p.author)}, ${q(slugify(name))}, ${q(name)}, ${q(derived.excerpt)}, ${q(markdown)}, ${derived.wordCount}, ${q(derived.shape)}, ${q(derived.opening)}, ${p.allowDebate ? 1 : 0}, ${q(p.publishedAt)}, ${q(p.publishedAt)});`,
	);
}

// Reactions spread over the last six days, more of them recent, as on a
// living site; the times are made up but the same on every re-seed.
const minutesAgo = (key: string) => {
	const [a, b] = createHash("sha256").update(key).digest();
	return Math.round((a % 100) * (b % 100) * 0.86) + 3;
};
for (const r of seed.reactions) {
	const post = postIds.get(r.file);
	for (const [quality, count] of Object.entries(r.qualities)) {
		for (let i = 0; i < count; i++) {
			addUser(`seed-reader-${i}`, `Reader ${i + 1}`);
			const at = new Date(Date.now() - minutesAgo(`${r.file}/${quality}/${i}`) * 60_000).toISOString();
			sql.push(`INSERT INTO reactions (post_id, user_id, quality, created_at) VALUES (${q(post)}, ${q(`seed-reader-${i}`)}, ${q(quality)}, ${q(at)});`);
		}
	}
}

seed.comments.forEach((c, i) => {
	const post = postIds.get(c.file);
	const at = new Date(Date.now() - (seed.comments.length - i) * 3_600_000).toISOString();
	addUser(`seed-commenter-${i}`, c.name);
	sql.push(
		`INSERT INTO comments (id, post_id, user_id, body, author_note, created_at, updated_at) VALUES (${q(idFor(`comment-${i}`, 12))}, ${q(post)}, ${q(`seed-commenter-${i}`)}, ${q(c.body)}, ${q(c.authorNote)}, ${q(at)}, ${q(at)});`,
	);
});

writeFileSync(`${root}.seed.sql`, `${sql.join("\n")}\n`);
console.log(`.seed.sql: ${seed.authors.length} authors, ${seed.posts.length} posts, ${users.size} readers`);
