# Welcome to Fold MD

Fold MD is a quiet place to write **markdown**. The text you type stays plain source. Pull down the *sheet* at the top to see it rendered.

## The sheet

The sheet has two modes, switched from the toolbar:

1. **Scroll under**: as you scroll, text that slides under the sheet appears there rendered. Drag the handle down for more, or all the way down for a full preview.
2. **Current paragraph**: the sheet renders the block your cursor is in and dims everything else. It's handy for math, tables and code.

Press ⌘\ to hide or show the sheet. Click any rendered block to jump to its source.

> Writing is thinking. The sheet is there when you want to look, and out of the way when you don't.

## Math

Inline math looks like $e^{i\pi} + 1 = 0$, and money like $5 and $10 is left alone.

Display math gets its own block:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

$$
\mathbf{A} = \begin{pmatrix} a & b \\ c & d \end{pmatrix}, \qquad \det \mathbf{A} = ad - bc
$$

## Code

Inline `code` is monospaced. Fenced blocks are highlighted in the sheet:

```swift
struct Greeting {
    let name: String

    func render() -> String {
        "Hello, \(name)!" // a comment
    }
}
```

```js
const blocks = renderBlocks(text);
blocks.forEach((b) => console.log(b.start, b.end));
```

## Lists and links

- Plain `.md` files on disk, nothing hidden
- Native text editing: spelling, Writing Tools, text replacements
- A [link to CommonMark](https://commonmark.org) opens in your browser

| Mode | Shows |
| --- | --- |
| Scroll under | What you've scrolled past |
| Current paragraph | What you're editing |

---

## A longer stretch

Keep scrolling so this section passes under the sheet. Each paragraph turns into rendered text as it goes.

The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog. The quick brown fox jumps over the lazy dog.

Pack my box with five dozen liquor jugs. Pack my box with five dozen liquor jugs. Pack my box with five dozen liquor jugs. Pack my box with five dozen liquor jugs.

How vexingly quick daft zebras jump. How vexingly quick daft zebras jump. How vexingly quick daft zebras jump. How vexingly quick daft zebras jump.

Sphinx of black quartz, judge my vow. Sphinx of black quartz, judge my vow. Sphinx of black quartz, judge my vow. Sphinx of black quartz, judge my vow.

### The end

That's the whole tour.
