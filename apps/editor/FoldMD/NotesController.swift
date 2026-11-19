import AppKit
import SwiftUI

/// Self-notes in the editor: the soft amber wash on noted words, and each
/// note beside them on the left, always open: click into one and type. A
/// note whose words changed says so on the note itself, and notes whose
/// words went away are listed apart. Notes never reach either preview.
@MainActor
final class NotesController: NSObject, NSTextStorageDelegate {
    let store = SelfNoteStore()
    private weak var textView: FoldTextView?
    private let margin = NoteMarginView()
    private let toast = NoteToast()
    private let unattachedPill = NotePill()
    private var popover: NSPopover?
    /// The note the cursor is in (in the text), or being written.
    private var active: SelfNote.ID?
    /// The note being written in.
    private var editing: SelfNote.ID?
    /// The note the pointer is on: its words light up too.
    private var hovered: SelfNote.ID?
    /// Drift (words changed a lot) shows only once typing has paused.
    private var settled = true
    private var settleTimer: Timer?
    private var loading = false

    static let amber = NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 1.0, green: 0.66, blue: 0.3, alpha: 1)
            : NSColor(srgbRed: 0.85, green: 0.47, blue: 0.04, alpha: 1)
    }

    init(textView: FoldTextView) {
        self.textView = textView
        super.init()
        margin.controller = self
        textView.addSubview(margin)
        store.onChange = { [weak self] in self?.refreshSoon() }
        store.onUnattached = { [weak self] note in self?.wordsRemoved(note) }
        unattachedPill.onClick = { [weak self] in self?.showUnattached() }
        toast.onUndo = { [weak self] in self?.textView?.undoManager?.undo() }
    }

    /// Floating pieces (the message at the foot, the unattached-notes pill)
    /// stay put while the text scrolls.
    func attach(to scrollView: NSScrollView) {
        scrollView.addFloatingSubview(toast, for: .vertical)
        scrollView.addFloatingSubview(unattachedPill, for: .vertical)
        layoutFloating()
    }

    func setFileURL(_ url: URL?) {
        guard let text = textView?.string as NSString? else { return }
        store.setFileURL(url, text: text)
    }

    /// Replacing the whole text (opening, reverting) isn't an edit: the
    /// notes find their words again afterwards.
    func beginLoad() { loading = true }

    func endLoad() {
        loading = false
        guard let text = textView?.string as NSString? else { return }
        store.reanchor(in: text)
        refresh()
    }

    // MARK: Following edits

    nonisolated func textStorage(_ textStorage: NSTextStorage, didProcessEditing editedMask: NSTextStorageEditActions,
                                 range editedRange: NSRange, changeInLength delta: Int) {
        guard editedMask.contains(.editedCharacters) else { return }
        let text = textStorage.string
        MainActor.assumeIsolated {
            guard !loading else { return }
            store.textEdited(editedRange, delta: delta, in: text as NSString)
            settled = false
            settleTimer?.invalidate()
            settleTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.settled = true
                    self?.refresh()
                }
            }
            // After layout has caught up with the edit.
            refreshSoon()
        }
    }

    func selectionChanged() {
        guard let textView, editing == nil else { return }
        let inside = store.note(at: textView.selectedRange().location)?.id
        if inside != active {
            active = inside
            refresh()
        }
    }

    // MARK: Writing notes

    /// Adds a note on the selection, or on the paragraph the cursor is in,
    /// and puts the cursor in it.
    func addNote() {
        guard let textView else { return }
        let text = textView.string as NSString
        var range = textView.selectedRange()
        if range.length == 0 {
            range = text.paragraphRange(for: range)
            // Leave out the line break and trailing blanks.
            while range.length > 0, let scalar = Unicode.Scalar(text.character(at: NSMaxRange(range) - 1)),
                  CharacterSet.whitespacesAndNewlines.contains(scalar) {
                range.length -= 1
            }
        }
        guard range.length > 0 else { NSSound.beep(); return }
        let note = store.add(range: range, body: "", in: text)
        refresh()
        write(in: note.id)
    }

    /// Puts the cursor in a note, at the end of what it says.
    func write(in id: SelfNote.ID) {
        margin.card(for: id)?.beginWriting()
    }

    /// Back to the text (Esc in a note), where it was.
    func returnToText() {
        guard let textView else { return }
        textView.window?.makeFirstResponder(textView)
    }

    fileprivate func cardBeganWriting(_ id: SelfNote.ID) {
        editing = id
        active = id
        refresh()
    }

    fileprivate func cardEndedWriting(_ id: SelfNote.ID) {
        if editing == id { editing = nil }
        // A note left empty isn't kept.
        if let note = store.note(id), note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            store.remove(id)
        }
        active = nil
        selectionChanged()
        refresh()
    }

    fileprivate func cardTyped(_ id: SelfNote.ID, _ body: String) {
        store.update(id) { $0.body = body }
    }

    fileprivate func setDone(_ id: SelfNote.ID, _ done: Bool) {
        store.update(id) { $0.done = done }
        if done { returnToText() }
    }

    fileprivate func stillApplies(_ id: SelfNote.ID) {
        guard let text = textView?.string as NSString? else { return }
        store.confirm(id, in: text)
    }

    fileprivate func delete(_ id: SelfNote.ID) {
        if editing == id { returnToText() }
        store.remove(id)
    }

    /// The pointer went onto a note (or off it): light up its words.
    fileprivate func hover(_ id: SelfNote.ID?) {
        guard id != hovered else { return }
        hovered = id
        paintWords()
    }

    // MARK: Words removed

    private func wordsRemoved(_ note: SelfNote) {
        toast.show("Note moved to Unattached")
        layoutFloating()
    }

    private func showUnattached() {
        guard textView != nil else { return }
        popover?.close()
        let popover = NSPopover()
        popover.behavior = .transient
        popover.contentViewController = NSHostingController(rootView: unattachedList())
        popover.delegate = self
        self.popover = popover
        popover.show(relativeTo: unattachedPill.bounds, of: unattachedPill, preferredEdge: .minY)
    }

    /// The list in the popover, as the notes are now.
    private func unattachedList() -> UnattachedNotes {
        UnattachedNotes(
            notes: store.unattached,
            hasSelection: (textView?.selectedRange().length ?? 0) > 0,
            onAttach: { [weak self] id in
                guard let self, let textView = self.textView, textView.selectedRange().length > 0 else { return }
                self.store.attach(id, to: textView.selectedRange(), in: textView.string as NSString)
                self.popover?.close()
            },
            onDelete: { [weak self] id in
                guard let self else { return }
                self.store.remove(id)
                if self.store.unattached.isEmpty {
                    self.popover?.close()
                } else if let host = self.popover?.contentViewController as? NSHostingController<UnattachedNotes> {
                    // The deleted note leaves the list straight away.
                    host.rootView = self.unattachedList()
                }
            })
    }

    // MARK: Drawing

    /// The wash on noted words (stronger for the note you're in, writing or
    /// pointing at; done notes show theirs only then), and a dotted
    /// underline under words that changed since their note.
    private func paintWords() {
        guard let textView, let layout = textView.layoutManager else { return }
        let text = textView.string as NSString
        let full = NSRange(location: 0, length: text.length)
        layout.removeTemporaryAttribute(.backgroundColor, forCharacterRange: full)
        layout.removeTemporaryAttribute(.underlineStyle, forCharacterRange: full)
        layout.removeTemporaryAttribute(.underlineColor, forCharacterRange: full)
        for note in store.attached {
            guard let range = note.range, NSMaxRange(range) <= text.length else { continue }
            let lit = note.id == active || note.id == hovered
            if !note.done || lit {
                layout.addTemporaryAttribute(.backgroundColor, value: Self.amber.withAlphaComponent(lit ? 0.26 : 0.13), forCharacterRange: range)
            }
            if settled && note.hasDrifted(in: text) {
                layout.addTemporaryAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue | NSUnderlineStyle.patternDot.rawValue, forCharacterRange: range)
                layout.addTemporaryAttribute(.underlineColor, value: Self.amber, forCharacterRange: range)
            }
        }
    }

    /// Washes, the notes beside the text and the pill, from the notes as
    /// they are now.
    /// Refreshes once, at the end of this turn of the run loop, however
    /// many times it's asked before then (an edit asks two or three times).
    func refreshSoon() {
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.async { [weak self] in
            guard let self, self.refreshPending else { return }
            self.refresh()
        }
    }
    private var refreshPending = false

    func refresh() {
        refreshPending = false
        guard let textView, let layout = textView.layoutManager, let container = textView.textContainer else { return }
        let text = textView.string as NSString
        // Notes on the left need room beside the column.
        textView.hasNotes = !store.attached.isEmpty

        var placed: [NoteMarginView.Placed] = []
        for note in store.attached {
            guard let range = note.range, NSMaxRange(range) <= text.length else { continue }
            layout.ensureLayout(forCharacterRange: NSRange(location: 0, length: NSMaxRange(range)))
            let glyphs = layout.glyphRange(forCharacterRange: NSRange(location: range.location, length: 1), actualCharacterRange: nil)
            let line = layout.boundingRect(forGlyphRange: glyphs, in: container)
            placed.append(.init(note: note, top: line.minY + textView.textContainerOrigin.y, lineHeight: line.height,
                                drifted: settled && note.hasDrifted(in: text),
                                lit: note.id == active, writing: note.id == editing))
        }
        margin.frame = textView.bounds
        margin.background = textView.backgroundColor
        margin.update(placed, right: textView.columnLeft - FoldTextView.noteGap, width: textView.noteWidth)
        paintWords()
        unattachedPill.count = store.unattached.count
        layoutFloating()
    }

    private func layoutFloating() {
        guard let scroll = textView?.enclosingScrollView else { return }
        let visible = scroll.contentView.bounds
        let size = toast.fittingSize
        toast.frame = NSRect(x: visible.midX - size.width / 2, y: visible.maxY - size.height - 18, width: size.width, height: size.height)
        let pill = unattachedPill.fittingSize
        unattachedPill.frame = NSRect(x: visible.maxX - pill.width - 16, y: visible.maxY - pill.height - 16, width: pill.width, height: pill.height)
    }

    func viewResized() {
        refresh()
    }

    #if DEBUG
    /// For tests: a note with this text, without writing in it.
    func testAdd(range: NSRange, body: String) {
        guard let text = textView?.string as NSString? else { return }
        store.add(range: range, body: body, in: text)
    }

    /// For tests: as if the pointer were on the index-th note (or none).
    func testHover(_ index: Int) { margin.testHover(index) }

    /// For tests: the cursor into the index-th note.
    func testWrite(_ index: Int) { margin.testWrite(index) }

    /// For tests: each note, where it is and what state it's in.
    func describe() -> String {
        let text = (textView?.string ?? "") as NSString
        let notes = store.notes.map { note -> String in
            let words = note.range.map { "\"\(text.substring(with: $0))\" @\($0.location)" } ?? "UNATTACHED"
            let state = [note.done ? "done" : nil, note.hasDrifted(in: text) ? "drifted" : nil].compactMap { $0 }.joined(separator: ",")
            return "[\(words) body=\"\(note.body)\" \(state)]"
        }
        let file = store.fileURL.map { FileManager.default.fileExists(atPath: SelfNoteStore.notesURL(for: $0).path) ? "file=yes" : "file=no" } ?? "file=untitled"
        let column = textView.map { "column=\(Int($0.columnLeft))+\(Int($0.columnActualWidth)) notes=\(Int($0.noteWidth))" } ?? ""
        return "notes(\(store.notes.count)) \(file) \(column) cards=\(margin.describe()) pill=\(unattachedPill.count) toast=\(toast.isShowing) " + notes.joined(separator: " ")
    }
    #endif
}

extension NotesController: NSPopoverDelegate {
    nonisolated func popoverDidClose(_ notification: Notification) {
        MainActor.assumeIsolated {
            popover = nil
            refresh()
        }
    }
}

// MARK: - The notes beside the text

/// Lies over the text view and scrolls with it, so the notes slide under
/// the sheet with their words (and never appear on it). Only the notes take
/// clicks.
final class NoteMarginView: NSView {
    struct Placed {
        let note: SelfNote
        let top: CGFloat
        let lineHeight: CGFloat
        let drifted: Bool
        let lit: Bool
        let writing: Bool
    }

    weak var controller: NotesController?
    /// The page's colour, under each note's tint.
    var background: NSColor = .textBackgroundColor
    /// Kept from one refresh to the next, so a note being written in keeps
    /// its cursor (and its undo).
    private var cards: [SelfNote.ID: NoteCard] = [:]

    override var isFlipped: Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let hit = super.hitTest(point)
        return hit === self ? nil : hit
    }

    func card(for id: SelfNote.ID) -> NoteCard? { cards[id] }

    /// Each note to the left of the column (its right edge at `right`),
    /// level with the first line of its words. Notes that would overlap
    /// stack downward.
    func update(_ placed: [Placed], right: CGFloat, width: CGFloat) {
        let ids = Set(placed.map(\.note.id))
        for (id, card) in cards where !ids.contains(id) {
            card.removeFromSuperview()
            cards[id] = nil
        }
        guard width > 0 else { return }
        var nextFree: CGFloat = 0
        for item in placed.sorted(by: { $0.top < $1.top }) {
            let card: NoteCard
            if let existing = cards[item.note.id] {
                card = existing
            } else {
                card = NoteCard(id: item.note.id)
                card.controller = controller
                cards[item.note.id] = card
                addSubview(card)
            }
            card.background = background
            card.show(item.note, drifted: item.drifted, lit: item.lit)
            let height = card.height(forWidth: width)
            let y = max(item.top + item.lineHeight / 2 - card.tailY, nextFree)
            card.frame = NSRect(x: right - width, y: y, width: width, height: height)
            card.layoutContent()
            nextFree = y + height + 8
        }
    }

    #if DEBUG
    private var ordered: [NoteCard] { cards.values.sorted { $0.frame.minY < $1.frame.minY } }

    func testHover(_ index: Int) {
        for card in cards.values where card.isHovered { card.mouseExited(with: NSEvent()) }
        guard ordered.indices.contains(index) else { return }
        ordered[index].mouseEntered(with: NSEvent())
    }

    func testWrite(_ index: Int) {
        guard ordered.indices.contains(index) else { controller?.returnToText(); return }
        ordered[index].beginWriting()
    }

    func describe() -> String {
        ordered.map { $0.describe() }.joined(separator: ",")
    }
    #endif
}

/// One note, beside its words: a bubble with a small tail pointing at the
/// text, tinted like the wash on the words, holding the whole note. Click
/// in and type. While writing: Done and Delete underneath. A done note
/// folds to one faint line with a tick; its words changing puts "Words
/// changed" on top, with "Still applies" and "Done".
final class NoteCard: NSView, NSTextViewDelegate {
    let noteID: SelfNote.ID
    weak var controller: NotesController?
    var background: NSColor = .textBackgroundColor

    private var note: SelfNote?
    private var drifted = false
    private var lit = false
    private var hovering = false
    var isHovered: Bool { hovering }
    private var isWriting: Bool { window?.firstResponder === textView }

    private let textView = NoteTextView()
    private let changedLabel = NSTextField(labelWithString: "Words changed")
    private let stillApplies = NoteCard.button("Still applies")
    private let changedDone = NoteCard.button("Done")
    private let doneButton = NoteCard.button("Done")
    private let deleteButton = NSButton()
    private let undo = UndoManager()

    private static let tail: CGFloat = 6
    private static let padX: CGFloat = 11
    private static let padY: CGFloat = 8
    private static let font = NSFont.systemFont(ofSize: 12.5)
    private static let lineHeight: CGFloat = 17
    private static let rowHeight: CGFloat = 18

    init(id: SelfNote.ID) {
        noteID = id
        super.init(frame: .zero)
        textView.delegate = self
        textView.card = self
        textView.drawsBackground = false
        textView.isRichText = false
        textView.allowsUndo = true
        textView.font = Self.font
        textView.textColor = .labelColor
        textView.insertionPointColor = NotesController.amber
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.isVerticallyResizable = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = Self.lineHeight
        paragraph.maximumLineHeight = Self.lineHeight
        textView.defaultParagraphStyle = paragraph
        textView.typingAttributes = [.font: Self.font, .foregroundColor: NSColor.labelColor, .paragraphStyle: paragraph]
        addSubview(textView)

        changedLabel.font = .systemFont(ofSize: 11, weight: .semibold)
        changedLabel.textColor = NotesController.amber
        addSubview(changedLabel)
        stillApplies.target = self
        stillApplies.action = #selector(stillAppliesClicked)
        changedDone.target = self
        changedDone.action = #selector(doneClicked)
        doneButton.target = self
        doneButton.action = #selector(doneClicked)
        for button in [stillApplies, changedDone, doneButton] { addSubview(button) }

        deleteButton.isBordered = false
        deleteButton.image = NSImage(systemSymbolName: "trash", accessibilityDescription: "Delete note")?
            .withSymbolConfiguration(.init(pointSize: 11, weight: .regular))
        deleteButton.contentTintColor = .secondaryLabelColor
        deleteButton.toolTip = "Delete note"
        deleteButton.target = self
        deleteButton.action = #selector(deleteClicked)
        addSubview(deleteButton)

        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInActiveApp, .inVisibleRect], owner: self))
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }

    private static func button(_ title: String) -> NSButton {
        let button = NSButton(title: title, target: nil, action: nil)
        button.isBordered = false
        button.font = .systemFont(ofSize: 11.5, weight: .medium)
        return button
    }

    private func style(_ button: NSButton, _ title: String, _ color: NSColor) {
        button.attributedTitle = NSAttributedString(string: title, attributes: [
            .foregroundColor: color, .font: NSFont.systemFont(ofSize: 11.5, weight: .medium)])
    }

    // MARK: Showing the note

    func show(_ note: SelfNote, drifted: Bool, lit: Bool) {
        self.note = note
        self.drifted = drifted && !note.done
        self.lit = lit
        // Never under the cursor of someone typing in it.
        if !isWriting, textView.string != note.body { textView.string = note.body }
        let folded = note.done && !isWriting
        textView.textContainer?.maximumNumberOfLines = folded ? 1 : 0
        textView.textContainer?.lineBreakMode = folded ? .byTruncatingTail : .byWordWrapping
        textView.textColor = note.done ? .secondaryLabelColor : .labelColor
        style(doneButton, note.done ? "Not done" : "Done", .secondaryLabelColor)
        doneButton.isEnabled = !note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        style(stillApplies, "Still applies", NotesController.amber)
        style(changedDone, "Done", .secondaryLabelColor)
        needsDisplay = true
    }

    /// "Words changed" on top; "Still applies" and "Done" at the foot.
    private var showsChanged: Bool { drifted }
    /// Done and Delete at the foot, while writing (and not changed).
    private var showsActions: Bool { isWriting && !drifted }
    private var textLeft: CGFloat { Self.padX + (note?.done == true ? 15 : 0) }

    /// Where the tail is (from the top): level with the middle of the
    /// first line of the words.
    var tailY: CGFloat { Self.padY + (showsChanged ? Self.rowHeight : 0) + Self.lineHeight / 2 }

    private func textHeight(width: CGFloat) -> CGFloat {
        guard let layout = textView.layoutManager, let container = textView.textContainer,
              container.maximumNumberOfLines != 1 else { return Self.lineHeight }  // folded: one line, even if the note ends in a newline
        container.size = NSSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        return max(Self.lineHeight, ceil(layout.usedRect(for: container).height))
    }

    func height(forWidth width: CGFloat) -> CGFloat {
        let text = textHeight(width: width - Self.tail - textLeft - Self.padX)
        let foot = showsActions || showsChanged ? 6 + Self.rowHeight : 0
        return Self.padY * 2 + (showsChanged ? Self.rowHeight : 0) + text + foot
    }

    func layoutContent() {
        let body = NSRect(x: 0, y: 0, width: bounds.width - Self.tail, height: bounds.height)
        var y = Self.padY
        changedLabel.isHidden = !showsChanged
        stillApplies.isHidden = !showsChanged
        changedDone.isHidden = !showsChanged
        if showsChanged {
            changedLabel.sizeToFit()
            changedLabel.frame.origin = NSPoint(x: Self.padX, y: y)
            y += Self.rowHeight
        }
        let textWidth = body.width - textLeft - Self.padX
        textView.frame = NSRect(x: textLeft, y: y, width: textWidth, height: textHeight(width: textWidth))
        y = textView.frame.maxY + 6
        if showsChanged {
            stillApplies.sizeToFit()
            changedDone.sizeToFit()
            stillApplies.frame = NSRect(x: Self.padX - 1, y: y, width: stillApplies.frame.width, height: Self.rowHeight)
            changedDone.frame = NSRect(x: stillApplies.frame.maxX + 12, y: y, width: changedDone.frame.width, height: Self.rowHeight)
        }
        doneButton.isHidden = !showsActions
        deleteButton.isHidden = !showsActions
        if showsActions {
            doneButton.sizeToFit()
            doneButton.frame = NSRect(x: Self.padX - 1, y: y, width: doneButton.frame.width, height: Self.rowHeight)
            deleteButton.frame = NSRect(x: body.maxX - Self.padX - 16, y: y, width: 16, height: Self.rowHeight)
        }
    }

    // MARK: Drawing

    /// A rounded bubble with a small tail on the right, pointing at the
    /// text, drawn as one outline.
    private func shape() -> NSBezierPath {
        let rect = NSRect(x: 0, y: 0, width: bounds.width - Self.tail, height: bounds.height).insetBy(dx: 0.5, dy: 0.5)
        let r: CGFloat = 9
        let half: CGFloat = 4.5
        let tip = NSPoint(x: bounds.width - 0.5, y: tailY)
        let path = NSBezierPath()
        path.move(to: NSPoint(x: rect.minX + r, y: rect.minY))
        path.appendArc(from: NSPoint(x: rect.maxX, y: rect.minY), to: NSPoint(x: rect.maxX, y: rect.maxY), radius: r)
        path.line(to: NSPoint(x: rect.maxX, y: tip.y - half))
        path.line(to: tip)
        path.line(to: NSPoint(x: rect.maxX, y: tip.y + half))
        path.appendArc(from: NSPoint(x: rect.maxX, y: rect.maxY), to: NSPoint(x: rect.minX, y: rect.maxY), radius: r)
        path.appendArc(from: NSPoint(x: rect.minX, y: rect.maxY), to: NSPoint(x: rect.minX, y: rect.minY), radius: r)
        path.appendArc(from: NSPoint(x: rect.minX, y: rect.minY), to: NSPoint(x: rect.maxX, y: rect.minY), radius: r)
        path.close()
        path.lineJoinStyle = .round
        path.lineWidth = 1
        return path
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let note else { return }
        let on = lit || hovering || isWriting
        let amber = NotesController.amber
        let path = shape()
        background.setFill()
        path.fill()
        if note.done {
            NSColor.secondaryLabelColor.withAlphaComponent(on ? 0.5 : 0.25).setStroke()
            path.stroke()
            drawTick(at: NSPoint(x: Self.padX, y: textView.frame.minY + Self.lineHeight / 2),
                     color: NSColor.secondaryLabelColor.withAlphaComponent(0.8))
        } else {
            amber.withAlphaComponent(on ? 0.13 : 0.07).setFill()
            path.fill()
            amber.withAlphaComponent(on ? 0.6 : 0.32).setStroke()
            path.stroke()
        }
        if showsActions || showsChanged {
            NSColor.separatorColor.setFill()
            NSRect(x: Self.padX, y: textView.frame.maxY + 3, width: bounds.width - Self.tail - Self.padX * 2, height: 0.5).fill()
        }
    }

    private func drawTick(at point: NSPoint, color: NSColor) {
        let tick = NSBezierPath()
        tick.move(to: NSPoint(x: point.x, y: point.y))
        tick.line(to: NSPoint(x: point.x + 3, y: point.y + 3))
        tick.line(to: NSPoint(x: point.x + 9, y: point.y - 3.5))
        tick.lineWidth = 1.4
        tick.lineCapStyle = .round
        tick.lineJoinStyle = .round
        color.setStroke()
        tick.stroke()
    }

    // MARK: Writing

    func beginWriting() {
        window?.makeFirstResponder(textView)
        textView.setSelectedRange(NSRange(location: (textView.string as NSString).length, length: 0))
    }

    fileprivate func writingBegan() {
        controller?.cardBeganWriting(noteID)
    }

    fileprivate func writingEnded() {
        controller?.cardEndedWriting(noteID)
    }

    func textDidChange(_ notification: Notification) {
        controller?.cardTyped(noteID, textView.string)
    }

    /// A note's typing has its own undo, apart from the document's.
    func undoManager(for view: NSTextView) -> UndoManager? { undo }

    @objc private func doneClicked() {
        guard let note else { return }
        controller?.setDone(noteID, !note.done)
    }

    @objc private func stillAppliesClicked() {
        controller?.stillApplies(noteID)
    }

    @objc private func deleteClicked() {
        controller?.delete(noteID)
    }

    // MARK: Pointer

    override func mouseEntered(with event: NSEvent) {
        hovering = true
        needsDisplay = true
        controller?.hover(noteID)
    }

    override func mouseExited(with event: NSEvent) {
        hovering = false
        needsDisplay = true
        controller?.hover(nil)
    }

    /// A click anywhere on the note (not just on its words) writes in it.
    override func mouseDown(with event: NSEvent) {
        if !isWriting { beginWriting() }
    }

    #if DEBUG
    func describe() -> String {
        guard let note else { return "?" }
        return [note.done ? "done" : "note", drifted ? "changed" : nil, isWriting ? "writing" : nil, "x\(Int(frame.minX))w\(Int(frame.width))"]
            .compactMap { $0 }.joined(separator: "+")
    }
    #endif
}

/// The text of a note: tells its card when writing starts and stops; Esc
/// goes back to the document. Shows "A note to yourself" while empty.
final class NoteTextView: NSTextView {
    weak var card: NoteCard?

    override func becomeFirstResponder() -> Bool {
        let became = super.becomeFirstResponder()
        if became { card?.writingBeganSoon() }
        return became
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { card?.writingEndedSoon() }
        return resigned
    }

    override func cancelOperation(_ sender: Any?) {
        card?.controller?.returnToText()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty else { return }
        NSAttributedString(string: "A note to yourself", attributes: [
            .font: font ?? NSFont.systemFont(ofSize: 12.5), .foregroundColor: NSColor.tertiaryLabelColor,
        ]).draw(at: NSPoint(x: 0, y: 0))
    }
}

extension NoteCard {
    /// After the responder change has finished (the card's look and the
    /// layout depend on who has the cursor).
    fileprivate func writingBeganSoon() {
        DispatchQueue.main.async { [weak self] in self?.writingBegan() }
    }

    fileprivate func writingEndedSoon() {
        DispatchQueue.main.async { [weak self] in self?.writingEnded() }
    }
}

// MARK: - Floating pieces

/// A quiet message at the foot of the editor, with Undo; it fades away.
final class NoteToast: NSView {
    var onUndo: (() -> Void)?
    private let label = NSTextField(labelWithString: "")
    private let undo = NSButton(title: "Undo", target: nil, action: nil)
    private var hideTimer: Timer?
    private(set) var isShowing = false

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 15
        label.textColor = .white
        label.font = .systemFont(ofSize: 12.5, weight: .medium)
        undo.isBordered = false
        undo.attributedTitle = NSAttributedString(string: "Undo", attributes: [
            .foregroundColor: NotesController.amber, .font: NSFont.systemFont(ofSize: 12.5, weight: .semibold)])
        undo.target = self
        undo.action = #selector(undoClicked)
        let stack = NSStackView(views: [label, undo])
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 6, left: 14, bottom: 6, right: 12)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor), stack.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        alphaValue = 0
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var wantsUpdateLayer: Bool { true }

    // Called again when Light or Dark Mode changes.
    override func updateLayer() {
        layer?.backgroundColor = Theme.floating.cgColor
    }

    override var fittingSize: NSSize {
        let size = super.fittingSize
        return NSSize(width: max(size.width, 120), height: 30)
    }

    func show(_ message: String) {
        label.stringValue = message
        isHidden = false
        isShowing = true
        NSAnimationContext.runAnimationGroup { $0.duration = 0.2; animator().alphaValue = 1 }
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.hide() }
        }
    }

    private func hide() {
        isShowing = false
        NSAnimationContext.runAnimationGroup({ $0.duration = 0.4; animator().alphaValue = 0 }) { [weak self] in
            MainActor.assumeIsolated { if self?.isShowing == false { self?.isHidden = true } }
        }
    }

    @objc private func undoClicked() {
        onUndo?()
        hide()
    }
}

/// "2 unattached notes", bottom right, while any note has lost its words.
final class NotePill: NSView {
    var onClick: (() -> Void)?
    private let button = NSButton(title: "", target: nil, action: nil)

    var count = 0 {
        didSet {
            isHidden = count == 0
            button.attributedTitle = NSAttributedString(string: "\(count) unattached \(count == 1 ? "note" : "notes")", attributes: [
                .foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.systemFont(ofSize: 11.5, weight: .medium)])
        }
    }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 12
        layer?.backgroundColor = NSColor.quaternaryLabelColor.withAlphaComponent(0.12).cgColor
        button.isBordered = false
        button.target = self
        button.action = #selector(clicked)
        button.frame = bounds
        button.autoresizingMask = [.width, .height]
        addSubview(button)
        isHidden = true
    }

    required init?(coder: NSCoder) { fatalError() }

    override var fittingSize: NSSize {
        NSSize(width: button.attributedTitle.size().width + 24, height: 24)
    }

    @objc private func clicked() { onClick?() }
}

// MARK: - SwiftUI pieces

/// Notes whose words were deleted: put one back on the selected words, or
/// let it go.
struct UnattachedNotes: View {
    let notes: [SelfNote]
    let hasSelection: Bool
    let onAttach: (SelfNote.ID) -> Void
    let onDelete: (SelfNote.ID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Unattached notes").font(.system(size: 13, weight: .semibold))
            Text(hasSelection ? "Select words, then put a note back on them." : "Select some words to put a note back on them.")
                .font(.system(size: 11.5)).foregroundStyle(.secondary)
            ForEach(notes) { note in
                VStack(alignment: .leading, spacing: 4) {
                    Text(note.body).font(.system(size: 12.5))
                    Text("was on “\(note.original.prefix(60))\(note.original.count > 60 ? "…" : "")”")
                        .font(.system(size: 11)).foregroundStyle(.secondary)
                    HStack(spacing: 14) {
                        Button("Put on selection") { onAttach(note.id) }.disabled(!hasSelection)
                        Button("Delete", role: .destructive) { onDelete(note.id) }
                    }
                    .buttonStyle(.borderless)
                    .font(.system(size: 11.5, weight: .medium))
                }
                Divider()
            }
        }
        .padding(14)
        .frame(width: 300)
    }
}
