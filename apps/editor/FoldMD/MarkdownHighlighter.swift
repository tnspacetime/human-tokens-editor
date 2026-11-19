import AppKit

/// Light styling for the markdown source: bigger headings, real bold and
/// italics, monospaced code, and dimmed markers. The text itself never
/// changes and nothing is hidden, so the cursor always behaves normally.
///
/// After an edit it restyles only what changed. The text is split into
/// chunks at blank lines (a fenced code block or a $$ math block stays in
/// one chunk, blank lines and all), and every rule is local to a chunk, so
/// a chunk's styling depends on its own text alone. Styling moves with the
/// text when you edit, so the chunks before and after the edit that read
/// the same as last time are already right; only the ones between are
/// styled again. Typing ``` mid-document still turns everything after it
/// into code: those chunks all change.
@MainActor
final class MarkdownHighlighter {
    /// The chunks' text when they were last styled, in order.
    private var styled: [NSString] = []

    private let fence = regex(#"^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[ \t]*$|\z)"#)
    private let mathBlock = regex(#"^\$\$[\s\S]*?\$\$[ \t]*$"#)
    private let heading = regex(#"^(#{1,6})[ \t]+.*$"#)
    private let quote = regex(#"^[ \t]*>.*$"#)
    private let rule = regex(#"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$"#)
    private let listMarker = regex(#"^[ \t]*([-*+]|\d+[.)])[ \t]+"#)
    private let inlineCode = regex(#"(`)([^`\n]+)(`)"#)
    private let inlineMath = regex(#"(?<![\\$])(\$)(?=\S)([^$\n]*?\S)(\$)(?!\d)"#)
    private let link = regex(#"(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))"#)
    private let bold = regex(#"(\*\*|__)(?=\S)(.+?)(?<=\S)\1"#)
    private let italic = regex(#"(?<![*_\w])([*_])(?=[^\s*_])([^*_\n]*?[^\s*_])\1(?![*_\w])"#)

    /// Styles what changed since the last call; `everything` restyles the
    /// whole text (first load, a new text size).
    func apply(to storage: NSTextStorage, everything: Bool = false) {
        let ns = storage.string as NSString
        let ranges = Self.chunks(ns)
        let texts = ranges.map { ns.substring(with: $0) as NSString }
        var first = 0
        var last = texts.count
        if !everything, !styled.isEmpty {
            while first < min(texts.count, styled.count), texts[first].isEqual(to: styled[first] as String) { first += 1 }
            var same = 0
            while same < min(texts.count, styled.count) - first,
                  texts[texts.count - 1 - same].isEqual(to: styled[styled.count - 1 - same] as String) { same += 1 }
            last = texts.count - same
        }
        styled = texts
        guard first < last else { return }
        let start = ranges[first].location
        let region = NSRange(location: start, length: NSMaxRange(ranges[last - 1]) - start)
        guard region.length > 0 else { return }
        style(storage, in: region)
    }

    /// Splits the text into chunks that start at line starts: a chunk ends
    /// after a blank line, except inside a fenced code block or a $$ math
    /// block, which stay whole. (The same split as editor-gpui's styler.)
    static func chunks(_ ns: NSString) -> [NSRange] {
        let length = ns.length
        var buffer = [unichar](repeating: 0, count: length)
        ns.getCharacters(&buffer, range: NSRange(location: 0, length: length))
        return buffer.withUnsafeBufferPointer { chars in
            let newline: unichar = 0x0A, carriageReturn: unichar = 0x0D
            let backtick: unichar = 0x60, tilde: unichar = 0x7E, dollar: unichar = 0x24
            let space: unichar = 0x20, tab: unichar = 0x09
            /// Whether the line [from, to) starts with three of `c`.
            func opens(_ from: Int, _ to: Int, _ c: unichar) -> Bool {
                to - from >= 3 && chars[from] == c && chars[from + 1] == c && chars[from + 2] == c
            }
            var out: [NSRange] = []
            var start = 0
            var position = 0
            var fence: unichar? // ` or ~ while inside a fence
            var math = false
            while position < length {
                var contentsEnd = position
                while contentsEnd < length, chars[contentsEnd] != newline { contentsEnd += 1 }
                let lineEnd = contentsEnd < length ? contentsEnd + 1 : length
                if contentsEnd > position, chars[contentsEnd - 1] == carriageReturn { contentsEnd -= 1 }
                var trimmedEnd = contentsEnd // without trailing spaces and tabs
                while trimmedEnd > position, chars[trimmedEnd - 1] == space || chars[trimmedEnd - 1] == tab { trimmedEnd -= 1 }
                let endsWithMath = trimmedEnd - position >= 2 && chars[trimmedEnd - 1] == dollar && chars[trimmedEnd - 2] == dollar
                if let marker = fence {
                    // Closed by the same marker alone on its line.
                    if trimmedEnd - position == 3, opens(position, trimmedEnd, marker) { fence = nil }
                } else if math {
                    if endsWithMath { math = false }
                } else if opens(position, contentsEnd, backtick) {
                    fence = backtick
                } else if opens(position, contentsEnd, tilde) {
                    fence = tilde
                } else if contentsEnd - position >= 2, chars[position] == dollar, chars[position + 1] == dollar,
                          !(trimmedEnd - position >= 4 && endsWithMath) {
                    math = true
                }
                if fence == nil, !math, trimmedEnd == position || (position..<trimmedEnd).allSatisfy({ chars[$0] == space || chars[$0] == tab }) {
                    out.append(NSRange(location: start, length: lineEnd - start))
                    start = lineEnd
                }
                position = lineEnd
            }
            if start < length { out.append(NSRange(location: start, length: length - start)) }
            return out
        }
    }

    private func style(_ storage: NSTextStorage, in full: NSRange) {
        let text = storage.string
        let ns = text as NSString

        storage.beginEditing()
        defer { storage.endEditing() }
        storage.setAttributes(Theme.baseAttributes, range: full)

        // Ranges that inline rules must not touch (code, math).
        var blocked: [NSRange] = []
        func isFree(_ range: NSRange) -> Bool {
            !blocked.contains { NSIntersectionRange($0, range).length > 0 }
        }
        func matches(_ re: NSRegularExpression) -> [NSTextCheckingResult] {
            re.matches(in: text, range: full)
        }

        for m in matches(fence) {
            storage.addAttribute(.font, value: Theme.mono, range: m.range)
            let opening = ns.lineRange(for: NSRange(location: m.range.location, length: 0))
            storage.addAttribute(.foregroundColor, value: Theme.marker, range: NSIntersectionRange(opening, m.range))
            let closing = ns.lineRange(for: NSRange(location: max(m.range.location, NSMaxRange(m.range) - 1), length: 0))
            if closing.location != opening.location {
                storage.addAttribute(.foregroundColor, value: Theme.marker, range: NSIntersectionRange(closing, m.range))
            }
            blocked.append(m.range)
        }

        for m in matches(mathBlock) where isFree(m.range) {
            storage.addAttributes([.font: Theme.mono, .foregroundColor: Theme.math], range: m.range)
            blocked.append(m.range)
        }

        for m in matches(heading) where isFree(m.range) {
            let marks = m.range(at: 1)
            storage.addAttribute(.font, value: Theme.heading(level: marks.length), range: m.range)
            storage.addAttribute(.foregroundColor, value: Theme.marker, range: marks)
        }

        for m in matches(quote) where isFree(m.range) {
            storage.addAttribute(.foregroundColor, value: Theme.quote, range: m.range)
        }

        for m in matches(rule) where isFree(m.range) {
            storage.addAttribute(.foregroundColor, value: Theme.marker, range: m.range)
        }

        for m in matches(listMarker) where isFree(m.range) {
            storage.addAttribute(.foregroundColor, value: Theme.listMarker, range: m.range(at: 1))
        }

        for m in matches(inlineCode) where isFree(m.range) {
            storage.addAttribute(.font, value: Theme.mono, range: m.range)
            dim(storage, m.range(at: 1), m.range(at: 3))
            blocked.append(m.range)
        }

        for m in matches(inlineMath) where isFree(m.range) {
            storage.addAttributes([.font: Theme.mono, .foregroundColor: Theme.math], range: m.range)
            dim(storage, m.range(at: 1), m.range(at: 3))
            blocked.append(m.range)
        }

        for m in matches(link) where isFree(m.range) {
            storage.addAttribute(.foregroundColor, value: Theme.link, range: m.range(at: 2))
            dim(storage, m.range(at: 1), m.range(at: 3), m.range(at: 4), m.range(at: 5))
        }

        for m in matches(bold) where isFree(m.range) {
            addTrait(.boldFontMask, to: storage, in: m.range)
            dimDelimiters(storage, m)
        }

        for m in matches(italic) where isFree(m.range) {
            addTrait(.italicFontMask, to: storage, in: m.range)
            dimDelimiters(storage, m)
        }
    }

    private func dim(_ storage: NSTextStorage, _ ranges: NSRange...) {
        for range in ranges where range.location != NSNotFound {
            storage.addAttribute(.foregroundColor, value: Theme.marker, range: range)
        }
    }

    /// Dims the opening delimiter (group 1) and the matching closing one.
    private func dimDelimiters(_ storage: NSTextStorage, _ m: NSTextCheckingResult) {
        let open = m.range(at: 1)
        let close = NSRange(location: NSMaxRange(m.range) - open.length, length: open.length)
        dim(storage, open, close)
    }

    private func addTrait(_ trait: NSFontTraitMask, to storage: NSTextStorage, in range: NSRange) {
        storage.enumerateAttribute(.font, in: range) { value, subrange, _ in
            let font = (value as? NSFont) ?? Theme.body
            storage.addAttribute(.font, value: NSFontManager.shared.convert(font, toHaveTrait: trait), range: subrange)
        }
    }
}

private func regex(_ pattern: String) -> NSRegularExpression {
    // Patterns are constants; a typo should fail loudly during development.
    try! NSRegularExpression(pattern: pattern, options: [.anchorsMatchLines])
}
