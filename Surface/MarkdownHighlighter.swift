import AppKit

/// Light styling for the markdown source: bigger headings, real bold and
/// italics, monospaced code, and dimmed markers. The text itself never
/// changes and nothing is hidden, so the cursor always behaves normally.
///
/// It restyles the whole document on each edit, which is fine for normal
/// writing. Very long files would want incremental (per-paragraph) styling.
@MainActor
final class MarkdownHighlighter {
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

    func apply(to storage: NSTextStorage) {
        let text = storage.string
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)

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
