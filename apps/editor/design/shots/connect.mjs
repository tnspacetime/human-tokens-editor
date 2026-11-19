// For the publishing screenshot: connects Fold MD (debug build, publishing to
// the local site on :3100) to a throwaway test account, and removes it after.
//
//   node connect.mjs approve <user code> "<Name>"   sign in by the Dev sign-in, allow the code
//   node connect.mjs remove "<Name>"                delete that test account (and its author)
//
// Local only: the Dev sign-in exists only in `vite dev` on localhost.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = "http://localhost:3100";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const [command, ...rest] = process.argv.slice(2);

// Dev sign-in readers get this address (src/server/dev-sign-in.server.ts).
const email = (name) => `reader-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}@dev.localhost`;

if (command === "approve") {
	const [code, name] = rest;
	const signIn = await fetch(`${site}/api/auth/dev/sign-in`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: site },
		body: JSON.stringify({ as: "reader", name }),
	});
	const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
	if (!signIn.ok || !cookie) throw new Error(`dev sign-in: ${signIn.status}`);

	// Allow the code as /connect's Allow button does (a server function).
	const bun = join(root, "node_modules/.bun");
	const seroval = readdirSync(bun).find((d) => d.startsWith("seroval@"));
	const { toJSONAsync } = await import(join(bun, seroval, "node_modules/seroval/dist/index.js"));
	const fn = Buffer.from(
		JSON.stringify({ file: "/src/server/connect.functions.ts?tss-serverfn-split", export: "decideConnect_createServerFn_handler" }),
	).toString("base64url");
	const allow = await fetch(`${site}/_serverFn/${fn}`, {
		method: "POST",
		headers: { cookie, "x-tsr-serverFn": "true", "content-type": "application/json", accept: "application/json", origin: site, "sec-fetch-site": "same-origin" },
		body: JSON.stringify(await toJSONAsync({ data: { code, allow: true } })),
	});
	const reply = await allow.text();
	if (!allow.ok || reply.includes("$TSR/Error")) throw new Error(`allow: ${allow.status} ${reply.slice(0, 200)}`);
	console.log("allowed", code, "for", name);
} else if (command === "remove") {
	const [name] = rest;
	const address = email(name);
	// The author's posts, the author, then the account (sessions and the rest go with it).
	const sql = `DELETE FROM posts WHERE author_id IN (SELECT a.id FROM authors a JOIN users u ON u.id = a.user_id WHERE u.email = '${address}');
DELETE FROM authors WHERE user_id IN (SELECT id FROM users WHERE email = '${address}');
DELETE FROM users WHERE email = '${address}';`;
	execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--local", "--command", sql], { cwd: join(root, "apps/site"), stdio: "ignore" });
	console.log("removed", address);
} else {
	console.log("usage: node connect.mjs approve <code> <name> | remove <name>");
	process.exit(1);
}
