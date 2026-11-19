import AppKit
import UniformTypeIdentifiers

/// The native source editor. A plain NSTextView with a few additions: a
/// centred reading column; dropped markdown files open as documents instead
/// of inserting their path; images dropped or pasted are copied next to the
/// document; and self-notes, with the iOS-style menu over a selection.
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
            // Mid-edit, only part of the text may be laid out yet: don't
            // shrink to that part, or the scroll position gets pulled up and
            // the text jumps on every keystroke. Once layout is complete the
            // real height applies (shorter too, after a deletion).
            if layout.firstUnlaidCharacterIndex() < (textStorage?.length ?? 0) {
                newSize.height = max(newSize.height, frame.height)
            }
        }
        super.setFrameSize(newSize)
        layoutColumn()
        notesNeedLayout()
    }

    // MARK: The column

    /// Whether the document has notes beside its text: they're on the
    /// left, so the column moves right to make room when it has to.
    var hasNotes = false {
        didSet { if hasNotes != oldValue { layoutColumn() } }
    }

    /// Where the text column is (its left edge and width, in this view).
    private(set) var columnLeft: CGFloat = 28
    private(set) var columnActualWidth: CGFloat = 680
    /// How wide the notes beside the column are.
    private(set) var noteWidth: CGFloat = 0
    /// Space between a note and the text.
    static let noteGap: CGFloat = 22
    /// Told when the column moves, so the sheet can move its text with it:
    /// how far right of centre it is, and how much narrower than usual.
    var onColumnChange: ((CGFloat, CGFloat) -> Void)?

    override var textContainerOrigin: NSPoint {
        NSPoint(x: columnLeft, y: textContainerInset.height)
    }

    /// Centred, as on the published page. With notes, they take the left:
    /// when the window is too narrow for them beside the centred column,
    /// the column moves right (and, in a small window, gets narrower).
    private func layoutColumn() {
        let width = bounds.width
        let centred = max(28, (width - columnWidth) / 2)
        var left = centred
        var column = width - centred * 2
        var notes: CGFloat = 0
        if hasNotes {
            notes = min(240, max(160, width - columnWidth - 28 - Self.noteGap - 20))
            let needed = 20 + notes + Self.noteGap
            if centred < needed {
                left = needed
                column = max(300, min(columnWidth, width - needed - 28))
            }
        }
        noteWidth = notes
        guard abs(left - columnLeft) > 0.5 || abs(column - columnActualWidth) > 0.5 else { return }
        columnLeft = left
        columnActualWidth = column
        textContainerInset = NSSize(width: left, height: 28)
        textContainer?.containerSize = NSSize(width: column, height: .greatestFiniteMagnitude)
        needsDisplay = true
        // The sheet's column box (#content) has 28pt of padding either side
        // of its text, and Fold.setColumn places that box from where a
        // 680pt box would be centred: so the box goes 28pt left of the text.
        let moved = abs(left - centred) > 0.5 || abs(column - (width - centred * 2)) > 0.5
        let shift = left - 28 - (width - min(width, columnWidth)) / 2
        onColumnChange?(moved ? shift : 0, moved ? columnWidth - column : 0)
    }

    // MARK: Self-notes

    /// This document's notes to self (see NotesController).
    private(set) lazy var notes = NotesController(textView: self)
    let selectionMenu = SelectionMenu()
    private var notesLayoutPending = false

    /// The margin is laid out after the text (never while it's being laid out).
    private func notesNeedLayout() {
        guard !notesLayoutPending else { return }
        notesLayoutPending = true
        DispatchQueue.main.async { [weak self] in
            self?.notesLayoutPending = false
            self?.notes.viewResized()
        }
    }

    /// Edit ▸ Add Note (⌘⇧N), and the selection menu: a note on the selected
    /// words, or on the paragraph the cursor is in.
    @objc func addNoteAction(_ sender: Any?) {
        selectionMenu.hide()
        notes.addNote()
    }

    /// Letting go of the mouse with words selected (dragging, double- or
    /// triple-clicking) shows the menu over them.
    override func mouseDown(with event: NSEvent) {
        selectionMenu.hide()
        super.mouseDown(with: event) // returns once the mouse is let go
        if selectedRange().length > 0 { showSelectionMenu() }
    }

    func showSelectionMenu() {
        let range = selectedRange()
        guard range.length > 0, let layout = layoutManager, let container = textContainer else { return }
        let glyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        var first = layout.lineFragmentUsedRect(forGlyphAt: glyphs.location, effectiveRange: nil)
        let words = layout.boundingRect(forGlyphRange: glyphs, in: container)
        first.origin.x = words.minX
        first.size.width = min(first.width, words.width)
        first = first.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y)
        let pasteboard = NSPasteboard.general
        let canPaste = pasteboard.availableType(from: readablePasteboardTypes) != nil
        selectionMenu.show([
            .init(title: "Cut", enabled: isEditable) { [weak self] in self?.cut(nil) },
            .init(title: "Copy", enabled: true) { [weak self] in self?.copy(nil) },
            .init(title: "Paste", enabled: isEditable && canPaste) { [weak self] in self?.paste(nil) },
            .init(title: "Add Note", enabled: true) { [weak self] in self?.addNoteAction(nil) },
        ], over: first, in: self, visible: visibleRect)
    }

    override func keyDown(with event: NSEvent) {
        selectionMenu.hide()
        super.keyDown(with: event)
    }

    /// ⌘= as well as ⌘+ for Bigger Text: on most keyboards + is shift-=, and
    /// people press it without the shift.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags == .command, event.charactersIgnoringModifiers == "=" {
            TextSize.grow()
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func resignFirstResponder() -> Bool {
        selectionMenu.hide()
        return super.resignFirstResponder()
    }

    /// Right-click: Add Note first.
    override func menu(for event: NSEvent) -> NSMenu? {
        selectionMenu.hide()
        let menu = super.menu(for: event) ?? NSMenu()
        let item = NSMenuItem(title: "Add Note", action: #selector(addNoteAction(_:)), keyEquivalent: "")
        item.target = self
        menu.insertItem(item, at: 0)
        menu.insertItem(.separator(), at: 1)
        return menu
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
    /// to it, and its notes kept beside it (nil while untitled).
    var documentURL: URL? {
        didSet {
            notes.setFileURL(documentURL)
            if oldValue == nil, let documentURL {
                // After this update, not during it: it changes the text.
                DispatchQueue.main.async { [weak self] in self?.adoptUnsavedPictures(into: documentURL) }
            }
        }
    }

    /// The document has a file now: pictures that waited in Fold MD's own
    /// folder while it was untitled go beside it, and their links follow.
    private func adoptUnsavedPictures(into document: URL) {
        guard documentURL == document else { return }
        let moves = ImageImporter.adoptUnsaved(in: string, document: document)
        guard !moves.isEmpty else { return }
        let text = string as NSString
        var edits: [(NSRange, String)] = []
        for (old, new) in moves {
            var search = NSRange(location: 0, length: text.length)
            while case let found = text.range(of: old, options: [], range: search), found.location != NSNotFound {
                edits.append((found, new))
                let next = NSMaxRange(found)
                search = NSRange(location: next, length: text.length - next)
            }
        }
        // From the end, so earlier ranges stay put.
        for (range, new) in edits.sorted(by: { $0.0.location > $1.0.location }) {
            guard shouldChangeText(in: range, replacementString: new) else { continue }
            textStorage?.replaceCharacters(in: range, with: new)
            didChangeText()
        }
    }

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
        // At the end of the line under the pointer, so a dropped picture
        // never splits a sentence.
        let pointer = characterIndexForInsertion(at: convert(sender.draggingLocation, from: nil))
        var lineEnd = 0
        (string as NSString).getLineStart(nil, end: nil, contentsEnd: &lineEnd,
                                          for: NSRange(location: min(pointer, (string as NSString).length), length: 0))
        let at = NSRange(location: lineEnd, length: 0)
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
