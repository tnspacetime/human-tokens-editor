// Re-works what's stored about each piece from its markdown (excerpt, word
// count, cover drawing, opening paragraphs, and the rendered HTML of it and
// its P.S.es): run it after the renderer, src/server/render.ts or
// src/server/derive.ts changes, or to fill in pieces from before a new
// column. Titles and links are left alone so nothing moves.
//
// Stored pages still show the old HTML until they're cleared: after running
// it on the live site, deploy (a deploy starts with nothing stored).
//
//   bun run db:derive            the local database
//   bun run db:derive --remote   the live one
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { deriveFromMarkdown } from "../src/server/derive";
import { renderMarkdown } from "../src/server/render";

const root = new URL("..", import.meta.url).pathname;
const where = process.argv.includes("--remote") ? "--remote" : "--local";
const wrangler = (...args: string[]) => {
	const run = spawnSync("bunx", ["wrangler", "d1", "execute", "DB", where, ...args], { cwd: root, encoding: "utf8" });
	if (run.status !== 0) throw new Error(run.stderr || run.stdout);
	return run.stdout;
};

const [{ results }] = JSON.parse(wrangler("--json", "--command", "SELECT id, markdown FROM posts")) as [
	{ results: { id: string; markdown: string }[] },
];
const q = (value: unknown) => (value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`);
const sql = results.map(({ id, markdown }) => {
	const d = deriveFromMarkdown(markdown);
	return `UPDATE posts SET excerpt = ${q(d.excerpt)}, word_count = ${d.wordCount}, shape = ${q(d.shape)}, opening = ${q(d.opening)}, html = ${q(renderMarkdown(markdown))} WHERE id = ${q(id)};`;
});
const [{ results: postscripts }] = JSON.parse(wrangler("--json", "--command", "SELECT id, body FROM postscripts")) as [
	{ results: { id: string; body: string }[] },
];
for (const { id, body } of postscripts) sql.push(`UPDATE postscripts SET html = ${q(renderMarkdown(body))} WHERE id = ${q(id)};`);
writeFileSync(`${root}.derive.sql`, `${sql.join("\n")}\n`);
wrangler("--file", ".derive.sql");
console.log(`Re-derived ${results.length} pieces (${where.slice(2)}).`);
