import { history, defaultKeymap, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	drawSelection,
	EditorView,
	keymap,
	placeholder,
	ViewPlugin,
	type ViewUpdate,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// The writing surface: CodeMirror 6, with the Markdown left as you type it
// and coloured the way Fold MD colours it (FoldMD/Theme.swift,
// MarkdownHighlighter.swift): headings bold and larger, the marks (#, *, `,
// >) faint, maths teal, code in mono, links in the accent. Only class names
// here; the colours are in styles/writer.css, so light and dark follow the
// site's theme.

const markdownStyle = HighlightStyle.define([
	{ tag: t.heading1, class: "md-h md-h1" },
	{ tag: t.heading2, class: "md-h md-h2" },
	{ tag: t.heading3, class: "md-h md-h3" },
	{ tag: [t.heading4, t.heading5, t.heading6], class: "md-h md-h4" },
	{ tag: [t.processingInstruction, t.contentSeparator], class: "md-mark" },
	{ tag: t.emphasis, class: "md-em" },
	{ tag: t.strong, class: "md-strong" },
	{ tag: t.strikethrough, class: "md-strike" },
	{ tag: t.monospace, class: "md-code" },
	{ tag: [t.link, t.url], class: "md-link" },
	{ tag: t.quote, class: "md-quote" },
	{ tag: t.labelName, class: "md-mark" },
]);

// Maths: $…$ inline and $$…$$ blocks, teal and in mono, as in Fold MD.
// (A whole post is small: finding them in all of it on each change is cheap.)
const MATH = /\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?![\s$])[^$\n]+?(?<![\s\\])\$(?![\w$])/g;
const mathMark = Decoration.mark({ class: "md-math" });

function findMath(state: EditorState): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const text = state.doc.toString();
	for (const match of text.matchAll(MATH)) builder.add(match.index, match.index + match[0].length, mathMark);
	return builder.finish();
}

const maths = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = findMath(view.state);
		}
		update(update: ViewUpdate) {
			if (update.docChanged) this.decorations = findMath(update.state);
		}
	},
	{ decorations: (plugin) => plugin.decorations },
);

export type EditorEvents = {
	/** The text changed. */
	change: (text: string) => void;
	/** The cursor moved to another source line (0-based). */
	cursor: (line: number) => void;
};

/** `covered`: how far the sheet reaches over the top of the editor (px), so the cursor is kept below it. */
export function createEditor(parent: HTMLElement, text: string, covered: () => number, events: EditorEvents): EditorView {
	let lastLine = -1;
	return new EditorView({
		parent,
		state: EditorState.create({
			doc: text,
			extensions: [
				history(),
				drawSelection(),
				EditorView.lineWrapping,
				markdown({ base: markdownLanguage }),
				syntaxHighlighting(markdownStyle),
				maths,
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				EditorView.scrollMargins.of(() => ({ top: covered() + 12 })),
				placeholder("# A title\n\nThen write. What you write stays in this browser until you publish it."),
				EditorView.contentAttributes.of({
					spellcheck: "true",
					autocorrect: "on",
					autocapitalize: "sentences",
					"aria-label": "Your post, in Markdown",
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) events.change(update.state.doc.toString());
					if (update.docChanged || update.selectionSet) {
						const line = update.state.doc.lineAt(update.state.selection.main.head).number - 1;
						if (line !== lastLine || update.docChanged) {
							lastLine = line;
							events.cursor(line);
						}
					}
				}),
			],
		}),
	});
}

/**
 * The source line (0-based, fractional) at the sheet's bottom edge, `edge`
 * px below the top of the editor's view: what's above it has slid under
 * the sheet.
 */
export function topLine(view: EditorView, edge: number): number {
	const height = view.scrollDOM.getBoundingClientRect().top + edge - view.documentTop;
	if (height <= 0) return 0;
	const block = view.lineBlockAtHeight(height);
	const line = view.state.doc.lineAt(block.from).number - 1;
	if (block.top > height) return line;
	return line + Math.min(1, (height - block.top) / Math.max(1, block.height));
}
