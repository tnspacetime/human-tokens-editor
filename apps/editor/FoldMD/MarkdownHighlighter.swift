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
    /// Marks text that isn't prose (code, math, a link's address), so the
    /// editor leaves its spelling alone (FoldTextView). Like the rest of the
    /// styling it's redone with the chunk, so it never outlives the code.
    nonisolated static let notProse = NSAttributedString.Key("FoldNotProse")

    /// The chunks' text when they were last styled, in order.
    private var styled: [NSString] = []
    /// The characters changed since then, as macOS reports them. Comparing
    /// text alone can't tell which of two identical blank lines is the new
    /// one (it carries the attributes of what it was typed after), so the
    /// chunks around a real edit are always styled again.
    private var edited: NSRange?
    private weak var watched: NSTextStorage?
    nonisolated(unsafe) private var observer: (any NSObjectProtocol)?

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    // A fence may be indented up to three spaces, like the page allows.
    private let fence = regex(#"^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|\z)"#)
    private let mathBlock = regex(#"^\$\$[\s\S]*?\$\$[ \t]*$"#)
    private let heading = regex(#"^(#{1,6})[ \t]+.*$"#)
    private let quote = regex(#"^[ \t]*>.*$"#)
    private let rule = regex(#"^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$"#)
    private let listMarker = regex(#"^[ \t]*([-*+]|\d+[.)])[ \t]+"#)
    /// - [ ] and - [x]: the page shows a checkbox.
    private let taskBox = regex(#"^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(\[[ xX]\])(?=[ \t]|$)"#)
    // A delimiter after a backslash is just the character (\* \_ \` \$).
    private let inlineCode = regex(#"(?<!\\)(`)([^`\n]+)(`)"#)
    private let inlineMath = regex(#"(?<![\\$])(\$)(?=\S)((?:\\\$|[^$\n])*?[^\s\\])(\$)(?!\d)"#)
    private let link = regex(#"(!?\[)([^\]\n]*)(\]\()([^)\n]*)(\))"#)
    // ** and * work inside a word (un**believ**able); __ and _ don't
    // (snake_case_name stays plain), as on the page.
    private let boldStars = regex(#"(?<![\\*])(\*\*)(?=[^\s*])(.+?)(?<=[^\s\\*])\*\*"#)
    private let boldUnderscores = regex(#"(?<![\\\w_])(__)(?=[^\s_])(.+?)(?<=[^\s\\_])__(?![\w_])"#)
    private let italicStar = regex(#"(?<![\\*])(\*)(?=[^\s*])([^*\n]*?[^\s*\\])\*(?!\*)"#)
    private let italicUnderscore = regex(#"(?<![\\\w_])(_)(?=[^\s_])([^_\n]*?[^\s_\\])_(?![\w_])"#)
    private let strike = regex(#"(?<![\\~])(~~)(?=[^\s~])(.+?)(?<=[^\s\\~])~~(?!~)"#)

    /// Styles what changed since the last call; `everything` restyles the
    /// whole text (first load, a new text size).
    func apply(to storage: NSTextStorage, everything: Bool = false) {
        watch(storage)
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
            if let edited {
                for (index, range) in ranges.enumerated()
                where range.location <= NSMaxRange(edited) && NSMaxRange(range) >= edited.location {
                    first = min(first, index)
                    last = max(last, index + 1)
                }
            }
        }
        edited = nil
        styled = texts
        guard first < last else { return }
        // Each chunk on its own, whether styling everything or a few: so
        // the result can't depend on which chunks were styled together.
        storage.beginEditing()
        defer { storage.endEditing() }
        for range in ranges[first..<last] where range.length > 0 {
            style(storage, in: range)
        }
    }

    private func watch(_ storage: NSTextStorage) {
        guard watched !== storage else { return }
        if let observer { NotificationCenter.default.removeObserver(observer) }
        watched = storage
        observer = NotificationCenter.default.addObserver(forName: NSTextStorage.didProcessEditingNotification, object: storage, queue: nil) { [weak self] note in
            guard let storage = note.object as? NSTextStorage, storage.editedMask.contains(.editedCharacters) else { return }
            let range = storage.editedRange
            let delta = storage.changeInLength
            let length = storage.length
            MainActor.assumeIsolated { self?.noteEdit(range, changeInLength: delta, length: length) }
        }
    }

    /// Several edits before the next styling: cover them all (generously;
    /// styling a little more than needed is harmless).
    private func noteEdit(_ range: NSRange, changeInLength delta: Int, length: Int) {
        guard let old = edited else { edited = range; return }
        let start = min(old.location, range.location)
        let end = min(length, max(NSMaxRange(old) + max(0, delta), NSMaxRange(range)))
        edited = NSRange(location: start, length: max(0, end - start))
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
                var indented = position // up to three spaces, as fences may be
                while indented < min(position + 3, contentsEnd), chars[indented] == space { indented += 1 }
                if let marker = fence {
                    // Closed by the same marker alone on its line.
                    if trimmedEnd - indented == 3, opens(indented, trimmedEnd, marker) { fence = nil }
                } else if math {
                    if endsWithMath { math = false }
                } else if opens(indented, contentsEnd, backtick) {
                    fence = backtick
                } else if opens(indented, contentsEnd, tilde) {
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

    /// One chunk (`full`): its rules see only its own text.
    private func style(_ storage: NSTextStorage, in full: NSRange) {
        let text = storage.string
        let ns = text as NSString

        storage.setAttributes(Theme.baseAttributes, range: full)

        // Ranges that inline rules must not touch (code, math).
        var blocked: [NSRange] = []
        func isFree(_ range: NSRange) -> Bool {
            !blocked.contains { NSIntersectionRange($0, range).length > 0 }
        }
        func matches(_ re: NSRegularExpression) -> [NSTextCheckingResult] {
            re.matches(in: text, range: full)
        }

        // Code and $$ math blocks, whichever starts first: a ``` inside a
        // math block is part of the math, and $$ inside code is code.
        let blocks = (matches(fence).map { ($0, true) } + matches(mathBlock).map { ($0, false) })
            .sorted { $0.0.range.location < $1.0.range.location }
        for (m, isFence) in blocks where isFree(m.range) {
            if isFence {
                storage.addAttribute(.font, value: Theme.mono, range: m.range)
                let opening = ns.lineRange(for: NSRange(location: m.range.location, length: 0))
                storage.addAttribute(.foregroundColor, value: Theme.marker, range: NSIntersectionRange(opening, m.range))
                let closing = ns.lineRange(for: NSRange(location: max(m.range.location, NSMaxRange(m.range) - 1), length: 0))
                if closing.location != opening.location {
                    storage.addAttribute(.foregroundColor, value: Theme.marker, range: NSIntersectionRange(closing, m.range))
                }
            } else {
                storage.addAttributes([.font: Theme.mono, .foregroundColor: Theme.math], range: m.range)
            }
            storage.addAttribute(Self.notProse, value: true, range: m.range)
            blocked.append(m.range)
        }

        for m in matches(heading) where isFree(m.range) {
            let marks = m.range(at: 1)
            storage.addAttribute(.font, value: Theme.heading(level: marks.length), range: m.range)
            storage.addAttribute(.paragraphStyle, value: Theme.headingParagraph(level: marks.length),
                                 range: NSIntersectionRange(ns.paragraphRange(for: m.range), full))
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

        for m in matches(taskBox) where isFree(m.range) {
            storage.addAttributes([.font: Theme.mono, .foregroundColor: Theme.listMarker], range: m.range(at: 1))
        }

        for m in matches(inlineCode) where isFree(m.range) {
            storage.addAttributes([.font: Theme.mono, Self.notProse: true], range: m.range)
            dim(storage, m.range(at: 1), m.range(at: 3))
            blocked.append(m.range)
        }

        for m in matches(inlineMath) where isFree(m.range) {
            storage.addAttributes([.font: Theme.mono, .foregroundColor: Theme.math, Self.notProse: true], range: m.range)
            dim(storage, m.range(at: 1), m.range(at: 3))
            blocked.append(m.range)
        }

        for m in matches(link) where isFree(m.range) {
            storage.addAttribute(.foregroundColor, value: Theme.link, range: m.range(at: 2))
            dim(storage, m.range(at: 1), m.range(at: 3), m.range(at: 4), m.range(at: 5))
            // The address is not words; the link's text still is.
            if m.range(at: 4).length > 0 { storage.addAttribute(Self.notProse, value: true, range: m.range(at: 4)) }
        }

        for m in matches(boldStars) + matches(boldUnderscores) where isFree(m.range) {
            addTrait(.boldFontMask, to: storage, in: m.range)
            dimDelimiters(storage, m)
        }

        for m in matches(italicStar) + matches(italicUnderscore) where isFree(m.range) {
            addTrait(.italicFontMask, to: storage, in: m.range)
            dimDelimiters(storage, m)
        }

        for m in matches(strike) where isFree(m.range) {
            let open = m.range(at: 1)
            let words = NSRange(location: NSMaxRange(open), length: m.range.length - open.length * 2)
            storage.addAttribute(.strikethroughStyle, value: NSUnderlineStyle.single.rawValue, range: words)
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
