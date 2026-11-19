// Markdown → HTML for Fold MD and human-tokens.dev. Both render with this, so
// a post looks the same in the editor's publishing surface and on the site.
//
//   const renderer = createRenderer({ resolveImage })
//   renderer.render(text)        HTML for the whole document
//   renderer.renderBlocks(text)  [{ start, end, html }] per top-level block,
//                                with its source line range (the editor
//                                uses these to keep the sheet in sync)
//   summarize(text)              { title, excerpt, cover } for feeds
//   outline(text)                the piece's shape, block by block, for
//                                the cover drawn on its feed tile
//   opening(text)                its first paragraphs as plain text
//
// Wrap the output in an element with class "fold-content" and include
// "@human-tokens/renderer/content.css".

import MarkdownIt from "markdown-it";
import katex from "katex";
import hljs from "highlight.js/lib/common";

/**
 * @param {object} [options]
 * @param {(src: string) => string | null} [options.resolveImage]
 *   Turns an image link as written into the URL to load. Return null when it
 *   can't be shown; the image becomes a note naming the link instead.
 * @param {string} [options.unresolvedImageLabel] The note's wording.
 */
export function createRenderer(options = {}) {
  const resolveImage = options.resolveImage ?? ((src) => src);
  const unresolvedLabel = options.unresolvedImageLabel ?? "Image not found";

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

  // Local files are fine to link (images next to the document, or anywhere on
  // disk); scripts never are, and only image data URLs.
  md.validateLink = (url) => {
    const link = url.trim().toLowerCase();
    if (/^(javascript|vbscript):/.test(link)) return false;
    if (link.startsWith("data:")) return /^data:image\/(gif|png|jpeg|webp);/.test(link);
    return true;
  };

  const defaultImage = md.renderer.rules.image;
  md.renderer.rules.image = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") || "";
    const resolved = resolveImage(src);
    // In a figure, the image's title (![alt](src "Caption")) is its caption.
    const title = token.meta?.figure ? token.attrGet("title") : null;
    const caption = title ? `<figcaption>${escapeHTML(title)}</figcaption>` : "";
    if (!resolved) return missingImage(src, unresolvedLabel) + caption;
    token.attrSet("src", resolved);
    token.attrSet("data-src", src);
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
    if (title) token.attrs = token.attrs.filter(([name]) => name !== "title");
    return defaultImage(tokens, idx, opts, env, self) + caption;
  };

  // A paragraph that is only images is a figure (several side by side make a
  // gallery), so pages can show pictures wider than the text.
  md.core.ruler.push("figures", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i + 2 < tokens.length; i++) {
      if (tokens[i].type !== "paragraph_open" || tokens[i + 2].type !== "paragraph_close") continue;
      const children = tokens[i + 1].children ?? [];
      const parts = children.filter((c) => !(c.type === "text" && !c.content.trim()) && c.type !== "softbreak");
      if (parts.length === 0 || !parts.every((c) => c.type === "image")) continue;
      const kind = parts.length > 1 ? "figure gallery" : "figure";
      tokens[i].meta = { figure: kind };
      tokens[i + 2].meta = { figure: kind };
      for (const image of parts) image.meta = { figure: parts.length === 1 };
      // Only the images: the spaces and line breaks between them would
      // otherwise sit between the gallery's pictures.
      tokens[i + 1].children = parts;
    }
  });
  const rule = (name) => md.renderer.rules[name] ?? ((tokens, idx, opts, env, self) => self.renderToken(tokens, idx, opts));
  const paragraphOpen = rule("paragraph_open");
  const paragraphClose = rule("paragraph_close");
  md.renderer.rules.paragraph_open = (tokens, idx, ...rest) =>
    tokens[idx].meta?.figure ? `<figure class="${tokens[idx].meta.figure}">` : paragraphOpen(tokens, idx, ...rest);
  md.renderer.rules.paragraph_close = (tokens, idx, ...rest) =>
    tokens[idx].meta?.figure ? "</figure>\n" : paragraphClose(tokens, idx, ...rest);

  // Wide tables scroll sideways inside their own box, not the whole page.
  const tableOpen = rule("table_open");
  const tableClose = rule("table_close");
  md.renderer.rules.table_open = (...args) => `<div class="table-wrap">${tableOpen(...args)}`;
  md.renderer.rules.table_close = (...args) => `${tableClose(...args)}</div>`;

  // A code block names its language (```swift), for a small label.
  const fence = rule("fence");
  md.renderer.rules.fence = (tokens, idx, ...rest) => {
    const html = fence(tokens, idx, ...rest);
    const lang = tokens[idx].info.trim().split(/\s+/)[0];
    return lang ? html.replace(/^<pre/, `<pre data-lang="${escapeHTML(lang)}"`) : html;
  };

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

  return {
    md,
    renderBlocks,
    render: (src) => md.render(src),
  };
}

// Parses only (summaries, shapes, openings), with the same math rules as
// the page, so a $$ block is math here too, not a paragraph.
const plain = new MarkdownIt({ html: false, linkify: false, typographer: true });
plain.use(mathPlugin);

/**
 * What a feed shows for a post: its first "# Heading", its first paragraph
 * as plain text, and its first image link (as written).
 */
export function summarize(src, { excerptLength = 280 } = {}) {
  const tokens = plain.parse(src, {});
  let title = null;
  let excerpt = null;
  let cover = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!title && token.type === "heading_open" && token.tag === "h1") {
      title = inlineText(tokens[i + 1]);
    } else if (token.type === "inline") {
      if (!cover) {
        const image = token.children?.find((child) => child.type === "image");
        if (image) cover = image.attrGet("src");
      }
      if (!excerpt && tokens[i - 1]?.type === "paragraph_open") {
        const text = inlineText(token).trim();
        if (text) excerpt = text.length > excerptLength ? `${text.slice(0, excerptLength).replace(/\s+\S*$/, "")}…` : text;
      }
    }
    if (title && excerpt && cover) break;
  }
  return { title, excerpt, cover };
}

/**
 * The shape of a piece: one entry per block, in order, with its size.
 *   ["h", level, words]  a heading (the opening "# Title" is left out)
 *   ["p", sentences]     a paragraph: each sentence's length in words
 *   ["li", sentences]    a list item
 *   ["q", sentences]     a paragraph inside a quote
 *   ["code", lines]      a code block or table
 *   ["img"]              a paragraph that is only an image
 *   ["hr"]               a rule
 */
export function outline(src) {
  const tokens = plain.parse(src, {});
  const shape = [];
  const within = [];
  let tookTitle = false;
  const words = (token) => inlineText(token).split(/\s+/).filter(Boolean).length;
  const sentences = (token) =>
    inlineText(token)
      .split(/(?<=[.!?…])["”’)]*\s+/)
      .map((sentence) => sentence.split(/\s+/).filter(Boolean).length)
      .filter((n) => n > 0);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    switch (token.type) {
      case "bullet_list_open":
      case "ordered_list_open":
        within.push("list");
        break;
      case "blockquote_open":
        within.push("quote");
        break;
      case "bullet_list_close":
      case "ordered_list_close":
      case "blockquote_close":
        within.pop();
        break;
      case "heading_open": {
        const level = Number(token.tag.slice(1));
        if (level === 1 && !tookTitle && shape.length === 0) tookTitle = true;
        else shape.push(["h", level, words(tokens[i + 1])]);
        break;
      }
      case "paragraph_open": {
        const inline = tokens[i + 1];
        const parts = inline?.children?.filter((c) => !(c.type === "text" && !c.content.trim()) && c.type !== "softbreak") ?? [];
        if (parts.length > 0 && parts.every((c) => c.type === "image")) {
          shape.push(["img"]);
          break;
        }
        const where = within.at(-1);
        const kind = where === "list" ? "li" : where === "quote" ? "q" : "p";
        // A list item's first paragraph is the item; later ones read as text.
        shape.push([kind, sentences(inline)]);
        break;
      }
      case "fence":
      case "code_block":
        shape.push(["code", token.content.replace(/\n$/, "").split("\n").length]);
        break;
      case "math_block":
        shape.push(["code", 2]);
        break;
      case "table_open": {
        let rows = 0;
        for (let j = i + 1; j < tokens.length && tokens[j].type !== "table_close"; j++) if (tokens[j].type === "tr_open") rows++;
        shape.push(["code", rows]);
        break;
      }
      case "hr":
        shape.push(["hr"]);
        break;
    }
  }
  return shape;
}

/**
 * The first paragraphs of a piece as plain text (the opening "# Title" left
 * out), up to about `words` words; the last one is cut with an ellipsis.
 */
export function opening(src, { words = 90 } = {}) {
  const tokens = plain.parse(src, {});
  const paragraphs = [];
  let count = 0;
  for (let i = 0; i < tokens.length && count < words; i++) {
    if (tokens[i].type !== "paragraph_open") continue;
    const text = inlineText(tokens[i + 1]).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const parts = text.split(" ");
    if (count + parts.length > words) {
      paragraphs.push(`${parts.slice(0, words - count).join(" ").replace(/[,;:.!?…]*$/, "")}…`);
      break;
    }
    paragraphs.push(text);
    count += parts.length;
  }
  return paragraphs;
}

function inlineText(token) {
  if (!token?.children) return token?.content ?? "";
  return token.children
    .map((child) =>
      child.type === "text" || child.type === "code_inline"
        ? child.content
        : child.type === "math_inline"
          ? `$${child.content}$`
          : child.type === "softbreak"
            ? " "
            : "",
    )
    .join("");
}

export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The note shown in place of an image that can't be shown. */
export function missingImage(src, reason) {
  return `<span class="img-missing"><span>${escapeHTML(reason)}</span> <code>${escapeHTML(safeDecode(src))}</code></span>`;
}

// ---------------------------------------------------------------- math

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
    // On one line, as the editor colours it ("$HOME and" + newline + "$PATH" isn't math).
    if (src.slice(start + 1, end).includes("\n")) return false;
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

