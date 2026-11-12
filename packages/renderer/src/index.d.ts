import type MarkdownIt from "markdown-it";

export interface RendererOptions {
	/** Turns an image link as written into the URL to load; null shows a note instead. */
	resolveImage?: (src: string) => string | null;
	/** The note's wording for an image resolveImage returned null for. */
	unresolvedImageLabel?: string;
}

export interface Block {
	/** First source line (0-based). */
	start: number;
	/** Line after the block. */
	end: number;
	html: string;
}

export interface Renderer {
	md: MarkdownIt;
	render(src: string): string;
	renderBlocks(src: string): Block[];
}

export function createRenderer(options?: RendererOptions): Renderer;

export function summarize(
	src: string,
	options?: { excerptLength?: number },
): { title: string | null; excerpt: string | null; cover: string | null };

/** One block of a piece's shape; see outline(). */
export type ShapeBlock =
	| ["h", level: number, words: number]
	| ["p" | "li" | "q", sentences: number[]]
	| ["code", lines: number]
	| ["img"]
	| ["hr"];

export function outline(src: string): ShapeBlock[];

/** The first paragraphs as plain text, up to about `words` words. */
export function opening(src: string, options?: { words?: number }): string[];

export function escapeHTML(value: unknown): string;
export function missingImage(src: string, reason: string): string;
