import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Server functions only answer the site's own pages (what Start does on its
// own when there's no start.ts).
const csrf = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" });

// Each page gets a fresh nonce: the router stamps it on the scripts it writes,
// and the browser runs no other script on the page.
function nonce() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes));
}

// What a page may load. Pictures may come from any https address: old posts
// may link one, and avatars come from Google and GitHub. Styles allow inline
// ones because maths (KaTeX) is laid out with them. In development the page
// also talks to Vite, which reloads it as files change.
function policy(nonce: string) {
	const dev = import.meta.env.DEV;
	return [
		"default-src 'self'",
		dev ? "script-src 'self' 'unsafe-inline'" : `script-src 'self' 'nonce-${nonce}'`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' https: data: blob:",
		"font-src 'self' data:",
		dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
}

// Headers every response gets, pages or not.
const ALWAYS: Record<string, string> = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
};

const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
	const id = nonce();
	const result = await next({ context: { nonce: id } });
	const page = result.response.headers.get("content-type")?.startsWith("text/html");
	const set = (headers: Headers) => {
		for (const [name, value] of Object.entries(ALWAYS)) if (!headers.has(name)) headers.set(name, value);
		if (page) headers.set("Content-Security-Policy", policy(id));
	};
	try {
		set(result.response.headers);
		return result;
	} catch {
		// Some responses (redirects) have headers that can't change: copy them.
		const copy = new Response(result.response.body, result.response);
		set(copy.headers);
		return copy;
	}
});

export const startInstance = createStart(() => ({
	requestMiddleware: [securityHeaders, csrf],
}));
