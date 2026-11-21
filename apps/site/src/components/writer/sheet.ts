import { createRenderer, missingImage } from "@human-tokens/renderer";

// The sheet at the top of the writer: your Markdown set as it will read,
// block by block, kept in step with the editor by source line. The same
// logic as Fold MD's sheet (apps/editor/web/src/renderer.js), and the same
// renderer as the site's pages, so it's set exactly as it will be published.
//
//   "under"  what you've scrolled past sits set, flush against the sheet's
//            bottom edge
//   "focus"  only the paragraph you're on, centred, the rest faded

export type SheetMode = "under" | "focus" | "off";

// Pictures: the site shows only pictures uploaded with a post (/img/<hash>)
// and web links; the writer can't upload them yet (Fold MD does).
export const renderer = createRenderer({
	resolveImage: (src) => (/^https:\/\//i.test(src) || /^\/img\/[0-9a-f]{64}$/.test(src) ? src : null),
	unresolvedImageLabel: "Pictures go up from Fold MD for now",
});

type Placed = { start: number; end: number; el: HTMLElement & { _html?: string } };

export class FoldSheet {
	private blocks: Placed[] = [];
	private focusIndex = -1;

	constructor(
		/** The sheet's scrolling box. */
		private readonly scroller: HTMLElement,
		/** The column the blocks go in, inside it, below a spacer as tall as the window. */
		private readonly content: HTMLElement,
	) {
		// A picture that doesn't load becomes a note saying which link is broken.
		content.addEventListener(
			"error",
			(event) => {
				const img = event.target;
				if (!(img instanceof HTMLImageElement)) return;
				const src = img.getAttribute("src") ?? "";
				const template = document.createElement("template");
				template.innerHTML = missingImage(src, "Image couldn't load");
				img.replaceWith(template.content);
			},
			true,
		);
	}

	/** Set the text again: only the blocks that changed touch the page. */
	setText(text: string) {
		const rendered = renderer.renderBlocks(text);
		// Blocks are matched by their HTML, not their place: a paragraph added
		// near the top moves the ones below instead of rebuilding them, so
		// their pictures and maths don't flash.
		const existing = new Map<string, Placed["el"][]>();
		for (const el of Array.from(this.content.children) as Placed["el"][]) {
			const key = el._html ?? "";
			const same = existing.get(key);
			if (same) same.push(el);
			else existing.set(key, [el]);
		}
		const els = rendered.map((block) => {
			let el = existing.get(block.html)?.shift();
			if (!el) {
				el = document.createElement("section");
				el.className = "blk";
				el.innerHTML = block.html;
				el._html = block.html;
			}
			el.dataset.start = String(block.start);
			return el;
		});
		for (const left of existing.values()) for (const el of left) el.remove();
		els.forEach((el, i) => {
			if (this.content.children[i] !== el) this.content.insertBefore(el, this.content.children[i] ?? null);
		});
		this.blocks = rendered.map((b, i) => ({ start: b.start, end: b.end, el: els[i] }));
		this.focusIndex = -1;
	}

	/** Where (px from the top of the column) a fractional source line lands. */
	private yForLine(line: number) {
		for (const b of this.blocks) {
			const top = b.el.offsetTop - this.content.offsetTop;
			if (line < b.start) return top;
			if (line < b.end) return top + ((line - b.start) / Math.max(1, b.end - b.start)) * b.el.offsetHeight;
		}
		return this.content.offsetHeight;
	}

	/** How tall the set text above `line` is: how much the sheet has to show. */
	fill(line: number) {
		return this.yForLine(line);
	}

	/** "Scroll under": everything above `line` sits set against the bottom edge. */
	showUnder(line: number) {
		for (const b of this.blocks) b.el.classList.remove("current");
		this.focusIndex = -1;
		const y = this.yForLine(line);
		this.scroller.scrollTop = Math.max(0, this.content.offsetTop + y - this.scroller.clientHeight);
	}

	/** "Paragraph": centre the block the cursor is in, and fade the rest. */
	showFocus(cursor: number, smooth: boolean) {
		const blocks = this.blocks;
		let index = -1;
		for (let i = 0; i < blocks.length && blocks[i].start <= cursor; i++) index = i;
		if (index < 0 && blocks.length) index = 0;
		blocks.forEach((b, i) => b.el.classList.toggle("current", i === index));
		if (index < 0) return;
		const b = blocks[index];
		const top = b.el.offsetTop;
		const height = b.el.offsetHeight;
		const view = this.scroller.clientHeight;
		let target: number;
		if (height <= view * 0.8) target = top + height / 2 - view / 2;
		else {
			const t = Math.min(1, Math.max(0, (cursor - b.start) / Math.max(1, b.end - b.start)));
			target = top + t * height - view / 2;
		}
		const moved = index !== this.focusIndex;
		this.focusIndex = index;
		this.scroller.scrollTo({ top: Math.max(0, target), behavior: smooth && moved ? "smooth" : "auto" });
	}

	/** The source line a click in the sheet landed on, to put the cursor there. */
	lineAt(target: EventTarget | null): number | null {
		if (!(target instanceof Element) || target.closest("a")) return null;
		const blk = target.closest<HTMLElement>(".blk");
		return blk ? Number(blk.dataset.start) : null;
	}
}
