import AppKit
import SwiftUI

/// SwiftUI wrapper around the native text view. It also reports two things to
/// the sheet: which source line is at the top of the editor (scroll-under
/// mode) and which line the cursor is on (current-paragraph mode).
struct SourceEditor: NSViewRepresentable {
    @Binding var text: String
    /// The document's file (nil while untitled), for images dropped in.
    let fileURL: URL?
    let sheet: PreviewBridge
    let page: PreviewBridge

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, sheet: sheet, page: page)
    }

    func makeNSView(context: Context) -> NSScrollView {
        // TextKit 1 on purpose: TextKit 2 estimates the height of off-screen
        // text, and restyling makes those estimates change, so the view jumped
        // while typing. TextKit 1 lays out exactly and stays put.
        let textView = FoldTextView(usingTextLayoutManager: false)
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isContinuousSpellCheckingEnabled = true
        textView.drawsBackground = true
        textView.backgroundColor = .textBackgroundColor
        textView.insertionPointColor = .controlAccentColor
        textView.font = Theme.body
        textView.typingAttributes = Theme.baseAttributes
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = .zero
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        // The column's width and place are set by the text view itself
        // (centred, or moved over for notes).
        textView.textContainer?.widthTracksTextView = false

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.documentView = textView

        textView.textStorage?.delegate = textView.notes
        textView.notes.attach(to: scrollView)

        context.coordinator.attach(textView: textView, scrollView: scrollView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.text = $text
        (scrollView.documentView as? FoldTextView)?.documentURL = fileURL
        context.coordinator.load(text)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        let sheet: PreviewBridge
        let page: PreviewBridge

        private weak var textView: FoldTextView?
        private weak var scrollView: NSScrollView?
        private let highlighter = MarkdownHighlighter()
        /// UTF-16 offset where each source line starts (line 0 is index 0).
        private var lineStarts: [Int] = [0]

        init(text: Binding<String>, sheet: PreviewBridge, page: PreviewBridge) {
            self.text = text
            self.sheet = sheet
            self.page = page
        }

        func attach(textView: FoldTextView, scrollView: NSScrollView) {
            self.textView = textView
            self.scrollView = scrollView
            textView.delegate = self

            let clip = scrollView.contentView
            clip.postsBoundsChangedNotifications = true
            NotificationCenter.default.addObserver(
                self, selector: #selector(clipBoundsChanged(_:)),
                name: NSView.boundsDidChangeNotification, object: clip)

            scrollView.postsFrameChangedNotifications = true
            NotificationCenter.default.addObserver(
                self, selector: #selector(scrollFrameChanged(_:)),
                name: NSView.frameDidChangeNotification, object: scrollView)

            NotificationCenter.default.addObserver(
                self, selector: #selector(textSizeChanged(_:)), name: TextSize.changed, object: nil)

            sheet.onJump = { [weak self] line in self?.jump(toLine: line) }
            page.onJump = { [weak self] line in self?.jump(toLine: line) }
            sheet.shiftEditor = { [weak self] dy in self?.shift(by: dy) }
            // Notes on the left move the column; the sheet's text follows.
            textView.onColumnChange = { [weak self] shift, narrower in
                self?.sheet.setColumn(shift: shift, narrower: narrower)
            }
        }

        /// Puts text from the document into the view (first load, revert).
        func load(_ newText: String) {
            guard let textView, textView.string != newText else { return }
            textView.notes.beginLoad()
            textView.string = newText
            textView.setSelectedRange(NSRange(location: 0, length: 0))
            textChanged(restyleAll: true)
            textView.notes.endLoad()
        }

        // MARK: NSTextViewDelegate

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            text.wrappedValue = textView.string
            textView.selectionMenu.hide()
            textChanged()
            pinTypingParagraph()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            reportCursor()
            textView?.notes.selectionChanged()
        }

        // MARK: Reporting to the sheet

        private func textChanged(restyleAll: Bool = false) {
            guard let textView, let storage = textView.textStorage else { return }
            highlighter.apply(to: storage, everything: restyleAll)
            textView.textEmptinessMayHaveChanged()
            lineStarts = Self.lineStarts(of: textView.string)
            reportScroll()
            reportCursor()
        }

        /// View ▸ Bigger or Smaller Text: restyle at the new size, keeping
        /// the line at the top of the editor where it was.
        @objc private func textSizeChanged(_ notification: Notification) {
            guard let textView, let scrollView, let layout = textView.layoutManager, let container = textView.textContainer else { return }
            let top = scrollView.contentView.bounds.minY - textView.textContainerInset.height
            let glyph = layout.glyphIndex(for: NSPoint(x: 0, y: max(0, top)), in: container)
            let char = layout.characterIndexForGlyph(at: glyph)
            textView.font = Theme.body
            textView.typingAttributes = Theme.baseAttributes
            textChanged(restyleAll: true)
            layout.ensureLayout(for: container)
            textView.setFrameSize(textView.frame.size)
            if char > 0 {
                let rect = layout.lineFragmentRect(forGlyphAt: layout.glyphIndexForCharacter(at: char), effectiveRange: nil)
                textView.scroll(NSPoint(x: 0, y: rect.minY + textView.textContainerInset.height))
            }
        }

        @objc private func clipBoundsChanged(_ notification: Notification) {
            reportScroll()
        }

        @objc private func scrollFrameChanged(_ notification: Notification) {
            // Let the whole document scroll up under the sheet, down to its
            // last line, so the end of a document can be rendered there too
            // (and typing at the end can be pinned below it). The text view
            // already has its bottom padding; the room on top of that lets the
            // last line pass the editor's top edge, plus a point for rounding.
            // The room comes from making the text view taller, not from the
            // scroll view's content insets: text drawn in an inset area can't
            // be clicked (clicks there land on the scroll view's background).
            guard let scrollView, let textView else { return }
            let room = scrollView.frame.height - textView.textContainerInset.height + 1
            textView.overscroll = max(0, room).rounded(.up)
            reportScroll()
        }

        private func reportScroll() {
            let line = topLine()
            if let textView, let scrollView {
                // Padding still showing above the first line (near the top).
                page.setTopGap(max(0, textView.textContainerOrigin.y - scrollView.contentView.bounds.minY))
            }
            sheet.scroll(topLine: line)
            page.scroll(topLine: line)
        }

        private func reportCursor() {
            guard let textView else { return }
            sheet.focus(line: line(atUTF16: textView.selectedRange().location))
        }

        /// The source line at the top edge of the editor, with a fraction for
        /// how far it has scrolled under (3.5 = halfway through line 3).
        private func topLine() -> Double {
            guard let textView, let scrollView,
                  let layout = textView.layoutManager,
                  let container = textView.textContainer
            else { return 0 }

            let y = scrollView.contentView.bounds.minY - textView.textContainerOrigin.y
            if y <= 0 { return 0 }
            // Right after an edit the layout around it is redone lazily; lay
            // out down to the top edge first, or for a moment it would look
            // as if the editor had scrolled past the end (and the sheet would
            // jump on every keystroke).
            layout.ensureLayout(forBoundingRect: CGRect(x: 0, y: y, width: container.size.width, height: 1), in: container)
            if y >= layout.usedRect(for: container).maxY {
                return Double(lineStarts.count) // scrolled past the end
            }
            let glyph = layout.glyphIndex(for: CGPoint(x: 0, y: y), in: container)
            let line = line(atUTF16: layout.characterIndexForGlyph(at: glyph))
            let rect = paragraphRect(line: line, layout: layout, container: container)
            let fraction = rect.height > 0 ? min(max((y - rect.minY) / rect.height, 0), 1) : 0
            return Double(line) + fraction
        }

        /// The laid-out rectangle of one source line (which may wrap).
        private func paragraphRect(line: Int, layout: NSLayoutManager, container: NSTextContainer) -> CGRect {
            guard let length = textView?.textStorage?.length else { return .zero }
            let start = lineStarts[line]
            let end = line + 1 < lineStarts.count ? lineStarts[line + 1] : length
            if start >= length { return layout.extraLineFragmentRect }
            let glyphs = layout.glyphRange(forCharacterRange: NSRange(location: start, length: max(1, end - start)), actualCharacterRange: nil)
            return layout.boundingRect(forGlyphRange: glyphs, in: container)
        }

        /// Typewriter scrolling for scroll-under mode: after each edit, scroll
        /// so the paragraph being typed starts just below the sheet. Earlier
        /// paragraphs are then under the sheet, rendered. A paragraph too tall
        /// to fit keeps the cursor line in view instead.
        func pinTypingParagraph() {
            guard sheet.mode == .under, sheet.isActive,
                  UserDefaults.standard.object(forKey: TypewriterScrollingToggle.key) as? Bool ?? true,
                  let textView, let scrollView,
                  let layout = textView.layoutManager,
                  let container = textView.textContainer,
                  let length = textView.textStorage?.length, length > 0
            else { return }

            let caretLine = line(atUTF16: textView.selectedRange().location)
            var firstLine = caretLine
            while firstLine > 0, !isBlank(line: firstLine - 1) { firstLine -= 1 }

            layout.ensureLayout(forCharacterRange: NSRange(location: 0, length: min(length, textView.selectedRange().location + 1)))
            let origin = textView.textContainerOrigin.y
            let paragraphTop = paragraphRect(line: firstLine, layout: layout, container: container).minY + origin
            let caretBottom = paragraphRect(line: caretLine, layout: layout, container: container).maxY + origin

            let clip = scrollView.contentView
            let topMargin: CGFloat = 14
            var y = paragraphTop - topMargin
            let room = clip.bounds.height * 0.7
            if caretBottom - y > room { y = caretBottom - room }

            let target = clip.constrainBoundsRect(NSRect(origin: NSPoint(x: 0, y: max(0, y)), size: clip.bounds.size)).origin
            guard abs(target.y - clip.bounds.minY) >= 1 else { return }
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.18
                context.allowsImplicitAnimation = true
                clip.animator().setBoundsOrigin(target)
            }
            scrollView.reflectScrolledClipView(clip)
        }

        private func isBlank(line: Int) -> Bool {
            guard let string = textView?.string as NSString?, line >= 0, line < lineStarts.count else { return true }
            let start = lineStarts[line]
            let end = line + 1 < lineStarts.count ? lineStarts[line + 1] : string.length
            return string.substring(with: NSRange(location: start, length: end - start))
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        /// Scrolls by `dy` (positive moves the text up). Used to keep the text
        /// still on screen while the sheet above it changes height.
        func shift(by dy: CGFloat) {
            guard let scrollView, dy != 0 else { return }
            let clip = scrollView.contentView
            let proposed = NSRect(origin: NSPoint(x: 0, y: clip.bounds.minY + dy), size: clip.bounds.size)
            clip.setBoundsOrigin(clip.constrainBoundsRect(proposed).origin)
            scrollView.reflectScrolledClipView(clip)
        }

        /// Clicking a block in the sheet: put the cursor at its first line
        /// and scroll it to the top of the editor, just below the sheet.
        private func jump(toLine line: Int) {
            guard let textView, let scrollView, line >= 0, line < lineStarts.count else { return }
            let offset = lineStarts[line]
            textView.window?.makeFirstResponder(textView)
            textView.setSelectedRange(NSRange(location: offset, length: 0))

            guard let layout = textView.layoutManager, let container = textView.textContainer else {
                textView.scrollRangeToVisible(NSRange(location: offset, length: 0))
                return
            }
            layout.ensureLayout(forCharacterRange: NSRange(location: 0, length: offset))
            let rect = paragraphRect(line: line, layout: layout, container: container)
            let clip = scrollView.contentView
            let y = rect.minY + textView.textContainerOrigin.y - 8
            let target = clip.constrainBoundsRect(NSRect(origin: NSPoint(x: 0, y: max(0, y)), size: clip.bounds.size))
            clip.scroll(to: target.origin)
            scrollView.reflectScrolledClipView(clip)
        }

        // MARK: Line bookkeeping

        private func line(atUTF16 offset: Int) -> Int {
            var low = 0
            var high = lineStarts.count - 1
            while low < high {
                let mid = (low + high + 1) / 2
                if lineStarts[mid] <= offset { low = mid } else { high = mid - 1 }
            }
            return low
        }

        private static func lineStarts(of string: String) -> [Int] {
            var starts = [0]
            var index = 0
            for unit in string.utf16 {
                index += 1
                if unit == 10 { starts.append(index) }
            }
            return starts
        }
    }
}
