import AppKit

/// The native source editor. A plain NSTextView with two additions: a centred
/// reading column, and dropped markdown files open as documents instead of
/// inserting their path.
final class FoldTextView: NSTextView {
    /// Matches max-width in web/src/renderer.css.
    var columnWidth: CGFloat = 680

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        let side = max(28, (newSize.width - columnWidth) / 2)
        if abs(textContainerInset.width - side) > 0.5 {
            textContainerInset = NSSize(width: side, height: 28)
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
