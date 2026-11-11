import AppKit
import SwiftUI

/// SwiftUI wrapper around the native text view. It also reports two things to
/// the sheet: which source line is at the top of the editor (scroll-under
/// mode) and which line the cursor is on (current-paragraph mode).
struct SourceEditor: NSViewRepresentable {
    @Binding var text: String
    let bridge: PreviewBridge

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text, bridge: bridge)
    }

    func makeNSView(context: Context) -> NSScrollView {
        // TextKit 1 on purpose: TextKit 2 estimates the height of off-screen
        // text, and restyling makes those estimates change, so the view jumped
        // while typing. TextKit 1 lays out exactly and stays put.
        let textView = SurfaceTextView(usingTextLayoutManager: false)
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
        textView.textContainer?.widthTracksTextView = true

        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.drawsBackground = true
        scrollView.backgroundColor = .textBackgroundColor
        scrollView.automaticallyAdjustsContentInsets = false
        scrollView.documentView = textView

        context.coordinator.attach(textView: textView, scrollView: scrollView)
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.text = $text
        context.coordinator.load(text)
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        let bridge: PreviewBridge

        private weak var textView: SurfaceTextView?
        private weak var scrollView: NSScrollView?
        private let highlighter = MarkdownHighlighter()
        /// UTF-16 offset where each source line starts (line 0 is index 0).
        private var lineStarts: [Int] = [0]

        init(text: Binding<String>, bridge: PreviewBridge) {
            self.text = text
            self.bridge = bridge
        }

        func attach(textView: SurfaceTextView, scrollView: NSScrollView) {
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

            bridge.onJump = { [weak self] line in self?.jump(toLine: line) }
        }

        /// Puts text from the document into the view (first load, revert).
        func load(_ newText: String) {
            guard let textView, textView.string != newText else { return }
            textView.string = newText
            textView.setSelectedRange(NSRange(location: 0, length: 0))
            textChanged()
        }

        // MARK: NSTextViewDelegate

        func textDidChange(_ notification: Notification) {
            guard let textView else { return }
            text.wrappedValue = textView.string
            textChanged()
            pinTypingParagraph()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            reportCursor()
        }

        // MARK: Reporting to the sheet

        private func textChanged() {
            guard let textView, let storage = textView.textStorage else { return }
            highlighter.apply(to: storage)
            lineStarts = Self.lineStarts(of: textView.string)
            reportScroll()
            reportCursor()
        }

        @objc private func clipBoundsChanged(_ notification: Notification) {
            reportScroll()
        }

        @objc private func scrollFrameChanged(_ notification: Notification) {
            // Let the last paragraph scroll all the way up to the sheet, so
            // typing at the end of a document can be pinned there too.
            guard let scrollView else { return }
            let bottom = max(0, scrollView.frame.height - 96).rounded()
            if scrollView.contentInsets.bottom != bottom {
                scrollView.contentInsets = NSEdgeInsets(top: 0, left: 0, bottom: bottom, right: 0)
            }
            reportScroll()
        }

        private func reportScroll() {
            bridge.scroll(topLine: topLine())
        }

        private func reportCursor() {
            guard let textView else { return }
            bridge.focus(line: line(atUTF16: textView.selectedRange().location))
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
            guard bridge.mode == .under, bridge.isSheetVisible,
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
