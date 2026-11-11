// Surface renderer: markdown → HTML blocks that remember which source lines
// they came from, so the native editor can drive the sheet by line number.
//
// API (called from Swift via callAsyncJavaScript):
//   Surface.setDocument(text)   re-render (only changed blocks touch the DOM)
//   Surface.setMode(mode)       "under" | "focus" (the sheet) | "page" (side panel)
//   Surface.scrollToLine(line)  fractional source line at the editor's top edge
//   Surface.focusLine(line)     source line the cursor is on

import MarkdownIt from "markdown-it";
import katex from "katex";
import hljs from "highlight.js/lib/common";

// ---------------------------------------------------------------- markdown

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {}
    }
    return ""; // markdown-it escapes it
  },
});
md.use(mathPlugin);

const mathCache = new Map();
function renderMath(tex, displayMode) {
  const key = (displayMode ? "D" : "I") + tex;
  let html = mathCache.get(key);
  if (html === undefined) {
    html = katex.renderToString(tex, { displayMode, throwOnError: false });
    if (mathCache.size > 500) mathCache.clear();
    mathCache.set(key, html);
  }
  return html;
}

// $inline$ and $$display$$ math. An unclosed $$ stays plain text, so the
// sheet doesn't flash red while you're still typing the block.
function mathPlugin(md) {
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
    if (src.charCodeAt(start + 1) === 0x24) return false;
    const first = src.charCodeAt(start + 1);
    if (Number.isNaN(first) || first === 0x20 || first === 0x09) return false;

    let end = start + 1;
    while ((end = src.indexOf("$", end)) !== -1 && src.charCodeAt(end - 1) === 0x5c /* \ */) end++;
    if (end === -1) return false;
    const last = src.charCodeAt(end - 1);
    if (last === 0x20 || last === 0x09) return false;
    const after = src.charCodeAt(end + 1);
    if (after >= 0x30 && after <= 0x39) return false; // "$5 and $10" is money

    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = src.slice(start + 1, end);
      token.markup = "$";
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.before(
    "fence",
    "math_block",
    (state, startLine, endLine, silent) => {
      const begin = state.bMarks[startLine] + state.tShift[startLine];
      const lineEnd = state.eMarks[startLine];
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.src.slice(begin, begin + 2) !== "$$") return false;

      const firstRest = state.src.slice(begin + 2, lineEnd).trim();
      let line = startLine;
      let content = null;

      if (firstRest.length >= 2 && firstRest.endsWith("$$")) {
        content = firstRest.slice(0, -2);
      } else {
        const lines = firstRest ? [firstRest] : [];
        while (++line < endLine) {
          const pos = state.bMarks[line] + state.tShift[line];
          const max = state.eMarks[line];
          const text = state.src.slice(pos, max).trim();
          if (text.endsWith("$$")) {
            lines.push(text.slice(0, -2));
            content = lines.join("\n");
            break;
          }
          lines.push(state.src.slice(state.bMarks[line], max));
        }
      }
      if (content === null) return false;
      if (silent) return true;

      state.line = line + 1;
      const token = state.push("math_block", "math", 0);
      token.block = true;
      token.content = content;
      token.map = [startLine, state.line];
      token.markup = "$$";
      return true;
    },
    { alt: ["paragraph", "reference", "blockquote", "list"] },
  );

  md.renderer.rules.math_inline = (tokens, i) => renderMath(tokens[i].content, false);
  md.renderer.rules.math_block = (tokens, i) =>
    `<div class="math-block">${renderMath(tokens[i].content, true)}</div>\n`;
}

// Parse once (so references resolve across the whole document), then render
// each top-level block separately with its [start, end) source line range.
function renderBlocks(src) {
  const env = {};
  const tokens = md.parse(src, env);
  const blocks = [];
  let i = 0;
  while (i < tokens.length) {
    const open = tokens[i];
    let j = i;
    if (open.nesting === 1) {
      for (let depth = 0; j < tokens.length; j++) {
        depth += tokens[j].nesting;
        if (depth === 0) break;
      }
    }
    const [start, end] = open.map || [0, 0];
    blocks.push({ start, end, html: md.renderer.render(tokens.slice(i, j + 1), md.options, env) });
    i = j + 1;
  }
  return blocks;
}

// ---------------------------------------------------------------- the sheet

const content = document.getElementById("content");
const state = { mode: "under", line: 0, cursor: 0, blocks: [], focusIndex: -1, anchor: 36 };

function setDocument(text) {
  const rendered = renderBlocks(text);
  rendered.forEach((block, i) => {
    let el = content.children[i];
    if (!el || el._html !== block.html) {
      const fresh = document.createElement("section");
      fresh.className = "blk";
      fresh.innerHTML = block.html;
      fresh._html = block.html;
      if (el) content.replaceChild(fresh, el);
      else content.appendChild(fresh);
      el = fresh;
    }
    el.dataset.start = block.start;
    el.dataset.end = block.end;
  });
  while (content.children.length > rendered.length) content.lastElementChild.remove();
  state.blocks = rendered.map((b, i) => ({ start: b.start, end: b.end, el: content.children[i] }));
  state.focusIndex = -1;
  reposition(false);
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
  window.scrollTo(0, Math.max(0, content.offsetTop + yForLine(state.line) - window.innerHeight));
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
  window.scrollTo(0, Math.max(0, content.offsetTop + yForLine(state.line) - state.anchor));
}

function reposition(smooth) {
  if (state.mode === "focus") applyFocus(smooth);
  else if (state.mode === "page") applyPage();
  else applyUnder();
}

content.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const blk = event.target.closest(".blk");
  if (!blk) return;
  window.webkit?.messageHandlers?.surface?.postMessage({ type: "jump", line: Number(blk.dataset.start) });
});

window.addEventListener("resize", () => reposition(false));

window.Surface = {
  setDocument,
  setMode(mode) {
    state.mode = ["focus", "page"].includes(mode) ? mode : "under";
    document.body.classList.toggle("focus", state.mode === "focus");
    document.body.classList.toggle("page", state.mode === "page");
    state.focusIndex = -1;
    reposition(false);
  },
  scrollToLine(line) {
    state.line = Number(line) || 0;
    if (state.mode === "under") applyUnder();
    else if (state.mode === "page") applyPage();
  },
  setAnchor(px) {
    state.anchor = Number(px) || 0;
    // Enough room above the first block for it to sit at the anchor too.
    content.style.setProperty("--page-top", `${Math.max(36, state.anchor)}px`);
    if (state.mode === "page") applyPage();
  },
  focusLine(line) {
    state.cursor = Number(line) || 0;
    if (state.mode === "focus") applyFocus(true);
  },
};
