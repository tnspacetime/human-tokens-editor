import { summarize } from "@human-tokens/renderer";
import type { EditorView } from "@codemirror/view";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useYou } from "../../lib/you";
import { type Draft, download, emptyDraft, fixable, loadDraft, type PublishedPost, saveDraft } from "./draft";
import { createEditor, topLine } from "./editor";
import { PublishFlow } from "./PublishFlow";
import { FoldSheet, renderer } from "./sheet";

// Fold MD in the browser (/write/web): the same writing surface, the same sheet
// at the top in its two modes, and the published page, which here comes
// down over everything instead of folding out to the right. Posts only;
// series stay in Fold MD. The draft is kept in this browser until you
// publish it (draft.ts).
//
// Laid out like Fold MD's window: its toolbar's capsules float under the
// site's island; under them, the sheet (warm, its own colour) lies over the
// top of the writing, and the text slides up under it as you scroll. Pull
// its edge to make it taller or shorter.

type Mode = "under" | "focus";

/** Where the sheet and the writing start: under the site's island and the toolbar floating over them. */
const TOP = 120;
const MODE_KEY = "ht.write.mode";
const SHEET_KEY = "ht.write.sheet";

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
	try {
		const value = localStorage.getItem(key) as T | null;
		return value && allowed.includes(value) ? value : fallback;
	} catch {
		return fallback;
	}
}

function store(key: string, value: string) {
	try {
		localStorage.setItem(key, value);
	} catch {}
}

const countWords = (text: string) => text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

export default function Writer() {
	const you = useYou();
	const [draft, setDraft] = useState<Draft>(loadDraft);
	const [kept, setKept] = useState(true);
	const [mode, setMode] = useState<Mode>(() => stored(MODE_KEY, ["under", "focus"] as const, "under"));
	const [sheetOpen, setSheetOpen] = useState(() => stored(SHEET_KEY, ["open", "closed"] as const, "open") === "open");
	const [previewOpen, setPreviewOpen] = useState(false);
	const [publishing, setPublishing] = useState(false);

	const writerRef = useRef<HTMLDivElement>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLDivElement>(null);
	const draftRef = useRef(draft);
	// What the layout works from, outside React (it changes on every scroll).
	const live = useRef({
		view: null as EditorView | null,
		sheet: null as FoldSheet | null,
		mode,
		sheetOpen,
		cursor: 0,
		/** Where you pulled the sheet's edge to (px under TOP), or null: it follows the text. */
		pulled: null as number | null,
		/** The sheet's height now (px). */
		height: 0,
		/** Room left above the writing for the sheet (px): in "paragraph" only. */
		room: -1,
		frame: 0,
		rendering: 0,
		saving: 0 as ReturnType<typeof setTimeout> | 0,
	});

	/**
	 * The sheet lies over the top of the writing and never moves it: what's
	 * under it shows there, set. In "scroll under" it opens as you scroll,
	 * up to about a third of the window, so the text slides up under it; in
	 * "paragraph" it stays open and the writing starts below it. Pulling its
	 * edge sets the height yourself, covering or uncovering the text.
	 */
	const layout = useCallback((smooth = false) => {
		const state = live.current;
		const { view, sheet } = state;
		const frame = writerRef.current;
		if (!view || !sheet || !frame) return;
		const most = Math.max(80, window.innerHeight - TOP - 160);
		const usual = Math.min(Math.round(window.innerHeight * 0.36), most);
		const height = !state.sheetOpen
			? 0
			: Math.min(state.pulled ?? (state.mode === "under" ? Math.min(usual, view.scrollDOM.scrollTop) : usual), most);
		const room = state.sheetOpen && state.mode === "focus" ? usual : 0;
		state.height = height;
		frame.style.setProperty("--sheet-h", `${height}px`);
		if (room !== state.room) {
			state.room = room;
			frame.style.setProperty("--sheet-room", `${room}px`);
			// The writing's room above it changed: place the set text again once the editor has measured.
			view.requestMeasure({ read() {}, write: () => schedule() });
		}
		if (!state.sheetOpen) return;
		if (state.mode === "under") sheet.showUnder(topLine(view, height));
		else sheet.showFocus(state.cursor, smooth);
	}, []);

	const schedule = useCallback(
		(smooth = false) => {
			cancelAnimationFrame(live.current.frame);
			live.current.frame = requestAnimationFrame(() => layout(smooth));
		},
		[layout],
	);

	// The editor and the sheet, once.
	useEffect(() => {
		const state = live.current;
		const scroller = scrollerRef.current;
		const content = contentRef.current;
		const host = editorRef.current;
		if (!scroller || !content || !host) return;
		const sheet = new FoldSheet(scroller, content);
		state.sheet = sheet;
		sheet.setText(draftRef.current.text);

		const view = createEditor(host, draftRef.current.text, () => state.height, {
			change(text) {
				const next = { ...draftRef.current, text };
				draftRef.current = next;
				setDraft(next);
				// Saved a moment after you stop, set in the sheet on the next frame.
				clearTimeout(state.saving || undefined);
				state.saving = setTimeout(() => setKept(saveDraft(draftRef.current)), 300);
				cancelAnimationFrame(state.rendering);
				state.rendering = requestAnimationFrame(() => {
					sheet.setText(draftRef.current.text);
					layout();
				});
			},
			cursor(line) {
				state.cursor = line;
				if (state.mode === "focus") schedule(true);
			},
		});
		state.view = view;
		layout();

		const onScroll = () => {
			if (state.mode === "under") schedule();
		};
		view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
		const onResize = () => schedule();
		window.addEventListener("resize", onResize);
		// Clicking set text puts the cursor on its line, as in Fold MD.
		const onClick = (event: MouseEvent) => {
			const line = sheet.lineAt(event.target);
			if (line === null) return;
			const target = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
			view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
			view.focus();
		};
		scroller.addEventListener("click", onClick);
		view.focus();
		return () => {
			view.scrollDOM.removeEventListener("scroll", onScroll);
			window.removeEventListener("resize", onResize);
			scroller.removeEventListener("click", onClick);
			clearTimeout(state.saving || undefined);
			saveDraft(draftRef.current);
			view.destroy();
			state.view = null;
		};
	}, [layout, schedule]);

	useEffect(() => {
		live.current.mode = mode;
		live.current.sheetOpen = sheetOpen;
		store(MODE_KEY, mode);
		store(SHEET_KEY, sheetOpen ? "open" : "closed");
		layout();
	}, [mode, sheetOpen, layout]);

	// If the browser won't keep the draft, say so before it's lost.
	useEffect(() => {
		if (kept) return;
		const warn = (event: BeforeUnloadEvent) => {
			if (draftRef.current.text.trim()) event.preventDefault();
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [kept]);

	// Pull the sheet's edge down or up; double-click it to let it open with the scrolling again.
	function pull(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		const start = event.clientY;
		const from = live.current.height;
		const move = (e: PointerEvent) => {
			live.current.pulled = Math.max(0, from + e.clientY - start);
			layout();
		};
		const up = () => {
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", up);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", up);
	}

	function replaceDraft(next: Draft) {
		draftRef.current = next;
		setDraft(next);
		setKept(saveDraft(next));
		const view = live.current.view;
		if (view && view.state.doc.toString() !== next.text) {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text } });
		}
	}

	const title = useMemo(() => summarize(draft.text).title, [draft.text]);
	const words = useMemo(() => countWords(draft.text), [draft.text]);
	const published = draft.published;
	const changed = !published || draft.text !== published.markdown;
	const publishLabel = published && !changed ? "Published" : published && fixable(published) ? "Fix" : "Publish";

	return (
		<div ref={writerRef} className="writer">
			<div className="writer-toolbar" role="toolbar" aria-label="Writing">
				<div className="writer-capsule" role="group" aria-label="What the sheet shows">
					<button
						type="button"
						className="writer-tool"
						aria-pressed={mode === "under"}
						onClick={() => {
							setMode("under");
							setSheetOpen(true);
						}}
						title="Scroll under: what you've scrolled past shows in the sheet, set"
					>
						<Icon name="under" />
						<span className="writer-tool-label">Scroll under</span>
					</button>
					<button
						type="button"
						className="writer-tool"
						aria-pressed={mode === "focus"}
						onClick={() => {
							setMode("focus");
							setSheetOpen(true);
						}}
						title="Paragraph: the sheet sets only the paragraph you're on"
					>
						<Icon name="focus" />
						<span className="writer-tool-label">Paragraph</span>
					</button>
				</div>
				<div className="writer-capsule" role="group" aria-label="Show">
					<button
						type="button"
						className="writer-tool"
						aria-pressed={sheetOpen}
						onClick={() => setSheetOpen(!sheetOpen)}
						title={sheetOpen ? "Hide the sheet" : "Show the sheet"}
						aria-label="Sheet"
					>
						<Icon name="sheet" />
					</button>
					<button
						type="button"
						className="writer-tool"
						aria-pressed={previewOpen}
						onClick={() => setPreviewOpen(true)}
						title="Preview: the post as readers will see it"
						aria-label="Preview"
					>
						<Icon name="page" />
					</button>
				</div>
				<div className="writer-capsule">
					<button
						type="button"
						className="writer-tool"
						onClick={() => download(draftRef.current.text, title)}
						title="Download this draft as a .md file"
						aria-label="Download .md"
					>
						<Icon name="download" />
					</button>
				</div>
				<button
					type="button"
					className="writer-publish"
					data-done={publishLabel === "Published" || undefined}
					onClick={() => setPublishing(true)}
					disabled={!draft.text.trim()}
				>
					<Icon name={publishLabel === "Published" ? "check" : "publish"} />
					{publishLabel}
				</button>
			</div>

			<div className="writer-sheet" data-mode={mode} data-closed={sheetOpen ? undefined : ""}>
				<div ref={scrollerRef} className="writer-sheet-scroller">
					<div className="writer-sheet-spacer">
						<p>{mode === "under" ? "Text you scroll past appears here, set." : ""}</p>
					</div>
					<div ref={contentRef} className="fold-content writer-sheet-content" />
				</div>
				<div
					className="writer-handle"
					onPointerDown={pull}
					onDoubleClick={() => {
						live.current.pulled = null;
						layout();
					}}
					title="Drag to make the sheet taller or shorter"
					aria-hidden="true"
				>
					<span />
				</div>
			</div>

			<div ref={editorRef} className="writer-editor" />

			<p className="writer-status" role="status">
				<span>{kept ? "Saved in this browser only" : "This browser isn't keeping it: download it before you leave"}</span>
				<span aria-hidden="true"> · </span>
				<span>
					{words.toLocaleString()} {words === 1 ? "word" : "words"}
				</span>
				<span aria-hidden="true"> · </span>
				<Link to="/write">Fold MD for Mac</Link>
			</p>

			<Preview open={previewOpen} text={draft.text} title={title} you={you} onClose={() => setPreviewOpen(false)} />

			<PublishFlow
				open={publishing}
				onClose={() => setPublishing(false)}
				you={you}
				draft={draft}
				onPublished={(post: PublishedPost, sourceId: string) => replaceDraft({ ...draftRef.current, sourceId, published: post })}
				onStartNew={() => replaceDraft(emptyDraft())}
			/>
		</div>
	);
}

/** The post as readers will see it: a page that comes down over the writer. */
function Preview({
	open,
	text,
	title,
	you,
	onClose,
}: {
	open: boolean;
	text: string;
	title: string | null;
	you: ReturnType<typeof useYou>;
	onClose: () => void;
}) {
	const close = useRef<HTMLButtonElement>(null);
	const page = useRef<HTMLDivElement>(null);
	// The post page puts the first "# Title" in the headline (p.$id.$slug.tsx).
	// Rendered only while open; on close the last render stays, so the sheet slides away with the post on it.
	const shown = useRef("");
	const html = useMemo(() => {
		if (open) shown.current = renderer.render(text).replace(/<h1>[\s\S]*?<\/h1>\n?/, "");
		return shown.current;
	}, [open, text]);

	useEffect(() => {
		if (!open) return;
		page.current?.scrollTo(0, 0);
		close.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const name = you?.user?.author?.name ?? you?.user?.name ?? "You";
	const minutes = Math.max(1, Math.round(countWords(text) / 230));
	// On the page itself, above the island too: the writer is its own layer.
	return createPortal(
		<div
			ref={page}
			className="writer-preview"
			data-open={open || undefined}
			role="dialog"
			aria-modal="true"
			aria-label="Preview"
			inert={!open}
		>
			<div className="writer-preview-bar">
				<span>Preview · as readers will see it</span>
				<button ref={close} type="button" onClick={onClose}>
					Back to writing
				</button>
			</div>
			<main className="post writer-preview-post">
				<div className="byline">
					<p className="byline-author">{name}</p>
					<p className="byline-date">
						Today<span aria-hidden="true"> · </span>
						{minutes} min read
					</p>
				</div>
				<h1 className="post-headline">{title ?? "Untitled"}</h1>
				<article className="fold-content post-body" dangerouslySetInnerHTML={{ __html: html }} />
			</main>
		</div>,
		document.body,
	);
}

/** The toolbar's symbols, drawn after Fold MD's (SF Symbols there). */
function Icon({ name }: { name: "under" | "focus" | "sheet" | "page" | "download" | "publish" | "check" }) {
	const paths: Record<typeof name, React.ReactNode> = {
		under: <path d="M8 14V5.5M4.5 9 8 5.5 11.5 9M3 2.5h10" />,
		focus: (
			<>
				<circle cx="8" cy="8" r="4.5" />
				<path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3" />
			</>
		),
		sheet: (
			<>
				<rect x="2" y="3" width="12" height="10" rx="2" />
				<path d="M2.5 6.5h11" />
				<path className="icon-fill" d="M3.5 3.6h9a1 1 0 0 1 1 1v1.4h-11V4.6a1 1 0 0 1 1-1Z" />
			</>
		),
		page: (
			<>
				<rect x="2" y="3" width="12" height="10" rx="2" />
				<path d="M8 3v10" />
			</>
		),
		download: <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10" />,
		publish: <path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" />,
		check: <path d="m3.5 8.5 3 3 6-7" />,
	};
	return (
		<svg className="writer-icon" viewBox="0 0 16 16" aria-hidden="true">
			{paths[name]}
		</svg>
	);
}
