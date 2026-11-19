// Fold MD's previews: the sheet above the editor and the publishing surface.
// Markdown → HTML comes from @human-tokens/renderer (shared with the site);
// this file keeps the blocks in sync with the editor by source line.
//
// API (called from Swift via callAsyncJavaScript):
//   Fold.setDocument(text)   re-render (only changed blocks touch the DOM)
//   Fold.setBase(dir, home)  the folder relative image links start from
//   Fold.setMode(mode)       "under" | "focus" (the sheet) | "page" (side panel)
//   Fold.scrollToLine(line)  fractional source line at the editor's top edge
//   Fold.focusLine(line)     source line the cursor is on
//   Fold.setSeries(info)     where this document sits in a series (page only)

import { createRenderer, escapeHTML, missingImage } from "@human-tokens/renderer";

// Images: web links load as they are. Local ones (relative to the document's
// folder, absolute, ~/ or file:) go through the app's fold-asset: handler.
// A relative link in an untitled document has nowhere to point yet.
const { renderBlocks, clearCache } = createRenderer({
  resolveImage,
  unresolvedImageLabel: "Save the document to show",
});

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
function safeDecode(text) {
  try { return decodeURIComponent(text); } catch { return text; }
}

function resolveImage(src) {
  if (/^(https?:|data:)/i.test(src)) return src;
  let path;
  try {
    if (/^file:/i.test(src)) path = safeDecode(new URL(src).pathname);
    else if (src.startsWith("/")) path = safeDecode(src);
    else if (src.startsWith("~/")) path = state.home + safeDecode(src.slice(1));
    else if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
    else if (state.base) path = safeDecode(new URL(src, "file://" + encodePath(state.base)).pathname);
    else return null;
  } catch {
    return null;
  }
  return "fold-asset://image" + encodePath(path);
}

// ---------------------------------------------------------------- the sheet

const content = document.getElementById("content");
const state = { mode: "under", line: 0, cursor: 0, blocks: [], focusIndex: -1, anchor: 36, base: null, home: "", text: null };

// The folder relative image links start from (the document's own folder).
function setBase(base, home) {
  state.base = base || null;
  state.home = home || "";
  clearCache(); // local pictures resolve from the new folder
  if (state.text !== null) setDocument(state.text);
}

// An image that doesn't load becomes a note saying which link is broken.
document.addEventListener("error", (event) => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !content.contains(img)) return;
  const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
  const template = document.createElement("template");
  template.innerHTML = missingImage(src, /^https?:/i.test(src) ? "Image couldn't load" : "Image not found");
  img.replaceWith(template.content);
  reposition(false);
}, true);
// A loaded image changes the height of its block.
document.addEventListener("load", (event) => {
  if (event.target instanceof HTMLImageElement) reposition(false);
}, true);

function setDocument(text) {
  state.text = text;
  const rendered = renderBlocks(text);
  // Blocks are matched by their HTML, not their position: a paragraph added
  // near the top moves the ones below it instead of rebuilding them, so
  // their pictures and math don't flash.
  const existing = new Map();
  for (const el of content.children) {
    const same = existing.get(el._html);
    if (same) same.push(el);
    else existing.set(el._html, [el]);
  }
  const els = rendered.map((block) => {
    let el = existing.get(block.html)?.shift();
    if (!el) {
      el = document.createElement("section");
      el.className = "blk";
      el.innerHTML = block.html;
      el._html = block.html;
    }
    el.dataset.start = block.start;
    el.dataset.end = block.end;
    return el;
  });
  for (const left of existing.values()) for (const el of left) el.remove();
  // Put them in order, moving only what's out of place.
  els.forEach((el, i) => {
    if (content.children[i] !== el) content.insertBefore(el, content.children[i] ?? null);
  });
  state.blocks = rendered.map((b, i) => ({ start: b.start, end: b.end, el: els[i] }));
  state.focusIndex = -1;
  reposition(false);
  announceFirstPaint();
}

// Tells the app once the first document has actually been painted, so it can
// show the preview (and a part that replaces another) without a flash.
let painted = false;
function announceFirstPaint() {
  if (painted) return;
  painted = true;
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    window.webkit?.messageHandlers?.fold?.postMessage({ type: "painted" });
  };
  // Two frames: the content has been drawn. A view with no height may get no
  // frames at all, so a short timer makes sure it's never left invisible.
  requestAnimationFrame(() => requestAnimationFrame(send));
  setTimeout(send, 150);
}

// Where (in px from the top of #content) a fractional source line lands.
function yForLine(line) {
  for (const b of state.blocks) {
    const top = b.el.offsetTop - content.offsetTop;
    if (line < b.start) return top;
    if (line < b.end) return top + ((line - b.start) / Math.max(1, b.end - b.start)) * b.el.offsetHeight;
  }
  return content.offsetHeight;
}

// "Scroll under": everything above the editor's top line sits rendered,
// flush against the bottom edge of the sheet.
function applyUnder() {
  const y = yForLine(state.line);
  window.scrollTo(0, Math.max(0, content.offsetTop + y - window.innerHeight));
  reportFill(y);
}

// Tells the app how much rendered text is above the editor, so the sheet
// can be just that tall (collapsed at the top of a document).
let lastFill = -1;
function reportFill(px) {
  const height = Math.round(px);
  if (height === lastFill) return;
  lastFill = height;
  window.webkit?.messageHandlers?.fold?.postMessage({ type: "fill", height });
}

// "Current paragraph": centre the block holding the cursor, dim the rest.
function applyFocus(smooth) {
  const blocks = state.blocks;
  let index = -1;
  for (let i = 0; i < blocks.length && blocks[i].start <= state.cursor; i++) index = i;
  if (index < 0 && blocks.length) index = 0;
  blocks.forEach((b, i) => b.el.classList.toggle("current", i === index));
  if (index < 0) return;

  const b = blocks[index];
  const top = b.el.offsetTop;
  const height = b.el.offsetHeight;
  const vh = window.innerHeight;
  let target;
  if (height <= vh * 0.8) {
    target = top + height / 2 - vh / 2;
  } else {
    const t = Math.min(1, Math.max(0, (state.cursor - b.start) / Math.max(1, b.end - b.start)));
    target = top + t * height - vh / 2;
  }
  const moved = index !== state.focusIndex;
  state.focusIndex = index;
  window.scrollTo({ top: Math.max(0, target), behavior: smooth && moved ? "smooth" : "auto" });
}

// "Page": the whole document like the published page. The editor's top line
// lands at `anchor` px from the top, which is where that line sat on screen
// in the editor, so sliding the page in keeps everything in place.
function applyPage() {
  // At the top of the document, show the top of the page (series header
  // included) rather than lining up the first line.
  const target = state.line <= 0 ? 0 : content.offsetTop + yForLine(state.line) - state.anchor;
  window.scrollTo(0, Math.max(0, target));
}

function reposition(smooth) {
  if (state.mode === "focus") applyFocus(smooth);
  else if (state.mode === "page") applyPage();
  else applyUnder();
}

// ---------------------------------------------------------------- series

const seriesHead = document.getElementById("series-head");
const seriesFoot = document.getElementById("series-foot");


// Where this document sits in a series (shown on the publishing surface).
function setSeries(info) {
  if (!info) {
    seriesHead.hidden = seriesFoot.hidden = true;
    seriesHead.innerHTML = seriesFoot.innerHTML = "";
  } else {
    seriesHead.innerHTML =
      `<span class="series-name">${escapeHTML(info.title)}</span>` +
      `<span class="series-part">Part ${info.index} of ${info.count}</span>`;
    const link = (part, label, side) =>
      part
        ? `<a class="series-link ${side}" href="#" data-path="${escapeHTML(part.path)}"><span>${label}</span><strong>${escapeHTML(part.title)}</strong></a>`
        : `<span class="series-link ${side} empty"></span>`;
    seriesFoot.innerHTML = link(info.previous, "Previous", "prev") + link(info.next, "Next", "next");
    seriesHead.hidden = false;
    seriesFoot.hidden = !(info.previous || info.next);
  }
  reposition(false);
}

seriesFoot.addEventListener("click", (event) => {
  const link = event.target.closest("[data-path]");
  if (!link) return;
  event.preventDefault();
  window.webkit?.messageHandlers?.fold?.postMessage({ type: "openPart", path: link.dataset.path });
});

content.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const blk = event.target.closest(".blk");
  if (!blk) return;
  window.webkit?.messageHandlers?.fold?.postMessage({ type: "jump", line: Number(blk.dataset.start) });
});

window.addEventListener("resize", () => reposition(false));

window.Fold = {
  setDocument,
  setBase,
  setSeries,
  setMode(mode) {
    state.mode = ["focus", "page"].includes(mode) ? mode : "under";
    document.body.classList.toggle("focus", state.mode === "focus");
    document.body.classList.toggle("page", state.mode === "page");
    state.focusIndex = -1;
    lastFill = -1;
    reposition(false);
  },
  scrollToLine(line) {
    state.line = Number(line) || 0;
    if (state.mode === "under") applyUnder();
    else if (state.mode === "page") applyPage();
  },
  setAnchor(px) {
    state.anchor = Number(px) || 0;
    if (state.mode === "page") applyPage();
  },
  // The editor's column moved right of centre and got narrower, to make
  // room for notes beside it: the sheet's text moves with it.
  setColumn(shift, narrower) {
    const content = document.getElementById("content");
    shift = Number(shift) || 0;
    narrower = Number(narrower) || 0;
    content.style.marginLeft = shift || narrower ? `calc((100% - min(100%, 680px)) / 2 + ${shift}px)` : "";
    content.style.maxWidth = narrower ? `${680 - narrower}px` : "";
    reposition(false);
  },
  focusLine(line) {
    state.cursor = Number(line) || 0;
    if (state.mode === "focus") applyFocus(true);
  },
};
