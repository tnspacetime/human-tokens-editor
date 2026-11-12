import AppKit
import UniformTypeIdentifiers

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

    // MARK: Dropping and pasting

    /// The document's file, so dropped or pasted images can be copied next
    /// to it (nil while untitled).
    var documentURL: URL?

    override var acceptableDragTypes: [NSPasteboard.PasteboardType] {
        super.acceptableDragTypes + [.png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier)]
            + NSFilePromiseReceiver.readableDraggedTypes.map { NSPasteboard.PasteboardType($0) }
    }

    override var readablePasteboardTypes: [NSPasteboard.PasteboardType] {
        super.readablePasteboardTypes + [.png, .tiff, NSPasteboard.PasteboardType(UTType.jpeg.identifier)]
    }

    override func dragOperation(for dragInfo: NSDraggingInfo, type: NSPasteboard.PasteboardType) -> NSDragOperation {
        let pasteboard = dragInfo.draggingPasteboard
        let urls = fileURLs(on: pasteboard)
        if urls.contains(where: { ImageImporter.isImage($0) || SeriesLibrary.isMarkdown($0) }) { return .copy }
        if urls.isEmpty, hasPromises(pasteboard) || ImageImporter.imageData(from: pasteboard) != nil { return .copy }
        return super.dragOperation(for: dragInfo, type: type)
    }

    /// Dropped markdown files open as documents. Dropped images (files, from
    /// Photos, or from a web page) are copied next to this document and linked.
    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let pasteboard = sender.draggingPasteboard
        let at = NSRange(location: characterIndexForInsertion(at: convert(sender.draggingLocation, from: nil)), length: 0)
        let urls = fileURLs(on: pasteboard)
        let documents = urls.filter(SeriesLibrary.isMarkdown)
        let images = urls.filter(ImageImporter.isImage)
        if !documents.isEmpty || !images.isEmpty {
            for url in documents {
                NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
            }
            if !images.isEmpty { insertImages(fromFiles: images, at: at) }
            return true
        }
        if urls.isEmpty, let receivers = pasteboard.readObjects(forClasses: [NSFilePromiseReceiver.self]) as? [NSFilePromiseReceiver],
           !receivers.isEmpty {
            receivePromises(receivers, at: at)
            return true
        }
        if urls.isEmpty, let (data, type) = ImageImporter.imageData(from: pasteboard) {
            insertImage(at: at) { try ImageImporter.importData(data, type: type, into: self.documentURL) }
            return true
        }
        return super.performDragOperation(sender)
    }

    /// Pasting an image (a screenshot, an image copied from a web page or
    /// Preview, or image files copied in Finder) copies it next to this
    /// document and links it. Text on the clipboard always wins.
    override func paste(_ sender: Any?) {
        let pasteboard = NSPasteboard.general
        let urls = fileURLs(on: pasteboard)
        if !urls.isEmpty, urls.allSatisfy(ImageImporter.isImage) {
            insertImages(fromFiles: urls, at: selectedRange())
        } else if urls.isEmpty, pasteboard.string(forType: .string) == nil,
                  let (data, type) = ImageImporter.imageData(from: pasteboard) {
            insertImage(at: selectedRange()) { try ImageImporter.importData(data, type: type, into: self.documentURL) }
        } else {
            super.paste(sender)
        }
    }

    /// Copies image files in and links them at `range` (also used by tests).
    func insertImages(fromFiles urls: [URL], at range: NSRange) {
        do {
            let links = try urls.map { try ImageImporter.importFile($0, into: documentURL) }
            insertImageLinks(links, at: range)
        } catch {
            presentImageError(error)
        }
    }

    private func insertImage(at range: NSRange, _ make: () throws -> String) {
        do { insertImageLinks([try make()], at: range) } catch { presentImageError(error) }
    }

    /// Images dragged out of Photos (and some other apps) arrive as files
    /// that are written a moment later; each is linked as it lands.
    private func receivePromises(_ receivers: [NSFilePromiseReceiver], at range: NSRange) {
        let drop = FileManager.default.temporaryDirectory.appending(path: "Fold MD Drops/\(UUID().uuidString)", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: drop, withIntermediateDirectories: true)
        var next = range
        for receiver in receivers {
            receiver.receivePromisedFiles(atDestination: drop, options: [:], operationQueue: .main) { [weak self] url, error in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    if let error { self.presentImageError(error); return }
                    guard ImageImporter.isImage(url) else { return }
                    let before = (self.string as NSString).length
                    self.insertImages(fromFiles: [url], at: next)
                    let inserted = (self.string as NSString).length - before
                    next = NSRange(location: next.location + max(0, inserted), length: 0)
                }
            }
        }
    }

    /// Writes the links as their own paragraph(s), replacing `range`.
    private func insertImageLinks(_ links: [String], at range: NSRange) {
        guard !links.isEmpty else { return }
        let text = string as NSString
        let start = min(range.location, text.length)
        let end = min(range.location + range.length, text.length)
        let before = text.substring(with: NSRange(location: max(0, start - 2), length: min(2, start)))
        let after = text.substring(with: NSRange(location: end, length: min(2, text.length - end)))
        let prefix = start == 0 || before.hasSuffix("\n\n") ? "" : before.hasSuffix("\n") ? "\n" : "\n\n"
        let suffix = after.hasPrefix("\n\n") ? "" : after.hasPrefix("\n") || after.isEmpty ? "\n" : "\n\n"
        let body = links.joined(separator: "\n\n")
        window?.makeFirstResponder(self)
        insertText(prefix + body + suffix, replacementRange: NSRange(location: start, length: end - start))
        setSelectedRange(NSRange(location: start + (prefix + body).utf16.count, length: 0))
    }

    private func presentImageError(_ error: Error) {
        if let window { presentError(error, modalFor: window, delegate: nil, didPresent: nil, contextInfo: nil) }
    }

    private func fileURLs(on pasteboard: NSPasteboard) -> [URL] {
        pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
    }

    private func hasPromises(_ pasteboard: NSPasteboard) -> Bool {
        let promised = Set(NSFilePromiseReceiver.readableDraggedTypes)
        return pasteboard.types?.contains { promised.contains($0.rawValue) } ?? false
    }
}
