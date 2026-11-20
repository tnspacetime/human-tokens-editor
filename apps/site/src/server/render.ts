import { createRenderer } from "@human-tokens/renderer";

// A post's markdown as HTML: rendered once, when it's published or fixed (and
// each P.S. when it's added), and stored with it, so a page being built again
// never redoes the maths and code highlighting. After the renderer changes,
// `bun run db:derive` renders every stored post again.
// No database or request here: the derive script uses it too.

// Images: pictures Fold MD uploaded with the piece (/img/<hash>, see
// images.server.ts), and web links.
export const renderer = createRenderer({
	resolveImage: (src) => (/^https:\/\//i.test(src) || /^\/img\/[0-9a-f]{64}$/.test(src) ? src : null),
	unresolvedImageLabel: "Image not uploaded yet",
});

export const renderMarkdown = (markdown: string) => renderer.render(markdown);
