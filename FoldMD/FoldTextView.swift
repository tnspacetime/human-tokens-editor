import AppKit

/// The native source editor. A plain NSTextView with two additions: a centred
/// reading column, and dropped markdown files open as documents instead of
/// inserting their path.
final class FoldTextView: NSTextView {
    /// Matches max-width in web/src/renderer.css.
    var columnWidth: CGFloat = 680

    /// Extra clickable room below the last line, so the end of a document can
    /// scroll up to the sheet.
    var overscroll: CGFloat = 0 {
        didSet {
            guard overscroll != oldValue else { return }
            setFrameSize(frame.size)
        }
    }

    override func setFrameSize(_ newSize: NSSize) {
        var newSize = newSize
        if let layout = layoutManager, let container = textContainer {
            let content = layout.usedRect(for: container).height + textContainerInset.height * 2
            newSize.height = max(content + overscroll, minSize.height)
        }
        super.setFrameSize(newSize)
        let side = max(28, (newSize.width - columnWidth) / 2)
        if abs(textContainerInset.width - side) > 0.5 {
            textContainerInset = NSSize(width: side, height: 28)
        }
    }

    /// A new window opens with the cursor in the text, ready to type.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let window else { return }
        DispatchQueue.main.async { [weak self, weak window] in
            guard let self, let window, window.firstResponder === window || window.firstResponder == nil else { return }
            window.makeFirstResponder(self)
        }
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = sender.draggingPasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [URL] ?? []
        let documents = urls.filter { ["md", "markdown", "mdown"].contains($0.pathExtension.lowercased()) }
        guard !documents.isEmpty else { return super.performDragOperation(sender) }
        for url in documents {
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        }
        return true
    }
}
