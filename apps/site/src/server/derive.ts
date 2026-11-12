import { opening, outline, summarize } from "@human-tokens/renderer";

// Everything worked out from a piece's markdown once, when it's published
// (or re-worked by `bun run db:derive` after the renderer changes), and
// stored with it, so showing the feed never re-reads whole pieces.
// No database or request here: the seed script uses it too.
export function deriveFromMarkdown(markdown: string) {
	const { title, excerpt } = summarize(markdown);
	return {
		title,
		excerpt,
		wordCount: markdown.split(/\s+/).filter(Boolean).length,
		shape: JSON.stringify(outline(markdown)),
		opening: JSON.stringify(opening(markdown)),
	};
}
