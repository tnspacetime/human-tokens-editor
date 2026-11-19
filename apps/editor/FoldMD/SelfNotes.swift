import AppKit

/// A note to yourself, on some words of the document. Never published: it
/// lives in a hidden file next to the document (".Name.md.notes"), never in
/// the markdown, so the .md stays clean and publishing can't leak it.
struct SelfNote: Codable, Identifiable, Equatable {
    let id: UUID
    var body: String
    var done: Bool
    let created: Date
    /// The words the note is on, as they were when it was written (or last
    /// confirmed with "Still applies"): what the note is about.
    var original: String
    /// The words it's on now, with a little text either side, to find them
    /// again when the document is opened (even after editing elsewhere).
    var quote: String
    var prefix: String
    var suffix: String
    /// Where the words were (UTF-16 offset), to choose between repeats.
    var location: Int

    /// Where the note is in the text now; nil when its words are gone
    /// ("unattached"). Not saved: worked out again on opening.
    var range: NSRange?
    /// Saved as true when its words were gone, so it stays unattached when
    /// the document is opened again (and doesn't settle on words elsewhere).
    var unattached: Bool?

    enum CodingKeys: String, CodingKey { case id, body, done, created, original, quote, prefix, suffix, location, unattached }

    /// Whether the noted words have changed enough that the note may no
    /// longer apply (more than half of the words are different).
    func hasDrifted(in text: NSString) -> Bool {
        guard let range, NSMaxRange(range) <= text.length else { return false }
        return SelfNote.similarity(original, text.substring(with: range)) < 0.5
    }

    static func similarity(_ a: String, _ b: String) -> Double {
        let words = { (s: String) in Set(s.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber }).map(String.init)) }
        let x = words(a), y = words(b)
        if x.isEmpty && y.isEmpty { return a == b ? 1 : 0 }
        return Double(x.intersection(y).count) / Double(x.union(y).count)
    }
}

/// The notes of one document: where they're kept, finding their words when
/// the document opens, and keeping them on their words while you edit.
@MainActor
final class SelfNoteStore {
    private(set) var notes: [SelfNote] = []
    /// Called after anything changes (to redraw, and to save).
    var onChange: (() -> Void)?
    /// Called when editing removed all of a note's words.
    var onUnattached: ((SelfNote) -> Void)?

    private(set) var fileURL: URL?
    private var saveTimer: Timer?
    nonisolated(unsafe) private var observers: [NSObjectProtocol] = []

    /// A save that's waiting happens now if a window closes or Fold MD
    /// quits, so the last words written in a note are never lost.
    init() {
        let center = NotificationCenter.default
        for name in [NSWindow.willCloseNotification, NSApplication.willTerminateNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.saveIfPending() }
            })
        }
    }

    deinit {
        observers.forEach(NotificationCenter.default.removeObserver)
    }

    func saveIfPending() {
        if saveTimer?.isValid == true { save() }
    }

    var attached: [SelfNote] { notes.filter { $0.range != nil } }
    var unattached: [SelfNote] { notes.filter { $0.range == nil } }

    // MARK: The file next to the document

    static func notesURL(for document: URL) -> URL {
        document.deletingLastPathComponent().appending(path: ".\(document.lastPathComponent).notes")
    }

    /// The document's file changed: read its notes (first open), or bring
    /// the notes along (saved for the first time, renamed or moved).
    func setFileURL(_ url: URL?, text: NSString) {
        guard url != fileURL else { return }
        let previous = fileURL
        fileURL = url
        guard let url else { return }
        let destination = Self.notesURL(for: url)
        if let previous {
            // Renamed or moved: the old notes file goes with it. Save As:
            // the original is still there, so it keeps its own notes.
            let source = Self.notesURL(for: previous)
            if !FileManager.default.fileExists(atPath: previous.path),
               FileManager.default.fileExists(atPath: source.path), !FileManager.default.fileExists(atPath: destination.path) {
                try? FileManager.default.moveItem(at: source, to: destination)
            }
            save()
        } else if !notes.isEmpty {
            // Notes written while the document was untitled.
            save()
        } else {
            read(from: destination, text: text)
        }
    }

    private struct File: Codable {
        var version = 1
        var notes: [SelfNote]
    }

    private func read(from url: URL, text: NSString) {
        guard let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder.notes.decode(File.self, from: data) else { return }
        notes = file.notes
        reanchor(in: text)
        onChange?()
    }

    /// Saves soon (edits come in bursts).
    func saveSoon() {
        saveTimer?.invalidate()
        saveTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.save() }
        }
    }

    func save() {
        saveTimer?.invalidate()
        guard let fileURL else { return }
        let url = Self.notesURL(for: fileURL)
        if notes.isEmpty {
            try? FileManager.default.removeItem(at: url)
            return
        }
        for index in notes.indices { notes[index].unattached = notes[index].range == nil ? true : nil }
        guard let data = try? JSONEncoder.notes.encode(File(notes: notes)) else { return }
        try? data.write(to: url, options: .atomic)
    }

    // MARK: Writing and changing notes

    @discardableResult
    func add(range: NSRange, body: String, in text: NSString) -> SelfNote {
        var note = SelfNote(id: UUID(), body: body, done: false, created: Date(), original: text.substring(with: range),
                            quote: "", prefix: "", suffix: "", location: range.location, range: range)
        Self.capture(&note, in: text)
        notes.append(note)
        changed()
        return note
    }

    func update(_ id: SelfNote.ID, _ change: (inout SelfNote) -> Void) {
        guard let index = notes.firstIndex(where: { $0.id == id }) else { return }
        change(&notes[index])
        changed()
    }

    func remove(_ id: SelfNote.ID) {
        notes.removeAll { $0.id == id }
        changed()
    }

    /// "Still applies": the note is now about the words as they are.
    func confirm(_ id: SelfNote.ID, in text: NSString) {
        update(id) { note in
            if let range = note.range { note.original = text.substring(with: range) }
        }
    }

    func attach(_ id: SelfNote.ID, to range: NSRange, in text: NSString) {
        update(id) { note in
            note.range = range
            note.original = text.substring(with: range)
            Self.capture(&note, in: text)
        }
    }

    func note(_ id: SelfNote.ID) -> SelfNote? { notes.first { $0.id == id } }

    /// The note whose words contain this position (the innermost one).
    func note(at location: Int) -> SelfNote? {
        attached
            .filter { $0.range.map { location >= $0.location && location <= NSMaxRange($0) } ?? false }
            .min { ($0.range?.length ?? 0) < ($1.range?.length ?? 0) }
    }

    private func changed() {
        saveSoon()
        onChange?()
    }

    // MARK: Following the text

    /// Called for every edit to the characters (not to styling): `edited` is
    /// the new text's range in the document, `delta` the change in length.
    func textEdited(_ edited: NSRange, delta: Int, in text: NSString) {
        let start = edited.location
        let oldEnd = NSMaxRange(edited) - delta
        let newEnd = NSMaxRange(edited)
        var lost: [SelfNote] = []
        for index in notes.indices {
            guard let range = notes[index].range else { continue }
            let a = range.location, b = NSMaxRange(range)
            var newA = a, newB = b
            if b <= start {
                continue // before the edit (typing right after it doesn't join it)
            } else if a >= oldEnd {
                newA += delta; newB += delta // after the edit
            } else {
                // The edit touches the noted words.
                if a > start { newA = a >= oldEnd ? a + delta : start }
                newB = b >= oldEnd ? b + delta : newEnd
            }
            newA = max(0, min(newA, text.length))
            newB = max(newA, min(newB, text.length))
            if newB - newA == 0 || text.substring(with: NSRange(location: newA, length: newB - newA))
                .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                notes[index].range = nil
                lost.append(notes[index])
            } else {
                notes[index].range = NSRange(location: newA, length: newB - newA)
            }
        }
        reattachUnattached(in: text)
        for index in notes.indices where notes[index].range != nil { Self.capture(&notes[index], in: text) }
        if !notes.isEmpty { saveSoon() }
        for note in lost where notes.first(where: { $0.id == note.id })?.range == nil { onUnattached?(note) }
    }

    /// Unattached notes whose words have come back (Undo, or pasted back in)
    /// near where they were go back on them.
    private func reattachUnattached(in text: NSString) {
        for index in notes.indices where notes[index].range == nil {
            if let found = Self.find(notes[index], in: text, near: true) {
                notes[index].range = found
            }
        }
    }

    /// Opening the document: find each note's words again.
    func reanchor(in text: NSString) {
        for index in notes.indices {
            notes[index].range = notes[index].unattached == true ? nil : Self.find(notes[index], in: text, near: false)
            if notes[index].range != nil { Self.capture(&notes[index], in: text) }
        }
    }

    /// The occurrence of a note's words that best fits: the same text either
    /// side, then the nearest to where it was. `near` only accepts one close
    /// to where it was (for reattaching while editing).
    private static func find(_ note: SelfNote, in text: NSString, near: Bool) -> NSRange? {
        guard !note.quote.isEmpty else { return nil }
        var best: (range: NSRange, score: Int)?
        var search = NSRange(location: 0, length: text.length)
        while search.length > 0 {
            let found = text.range(of: note.quote, options: [], range: search)
            if found.location == NSNotFound { break }
            let before = text.substring(with: NSRange(location: max(0, found.location - note.prefix.utf16.count),
                                                      length: min(found.location, note.prefix.utf16.count)))
            let afterStart = NSMaxRange(found)
            let after = text.substring(with: NSRange(location: afterStart,
                                                     length: min(text.length - afterStart, note.suffix.utf16.count)))
            let distance = abs(found.location - note.location)
            var score = -distance
            if before == note.prefix { score += 1_000_000 }
            if after == note.suffix { score += 1_000_000 }
            // Reattaching while editing needs the same text either side too,
            // so a note doesn't jump onto a repeat of its words nearby. On
            // opening, a few characters ("2") could be anywhere: they need
            // the same text either side as well.
            let context = before == note.prefix || after == note.suffix
            let fits = near ? distance < 400 && context : context || note.quote.count >= 12
            if fits, score > (best?.score ?? .min) { best = (found, score) }
            search = NSRange(location: found.location + 1, length: text.length - found.location - 1)
        }
        return best?.range
    }

    /// Remembers a note's words as they are now, and a little either side.
    private static func capture(_ note: inout SelfNote, in text: NSString) {
        guard let range = note.range, NSMaxRange(range) <= text.length else { return }
        let context = 32
        note.quote = text.substring(with: range)
        note.prefix = text.substring(with: NSRange(location: max(0, range.location - context), length: min(range.location, context)))
        let after = NSMaxRange(range)
        note.suffix = text.substring(with: NSRange(location: after, length: min(text.length - after, context)))
        note.location = range.location
    }
}

private extension JSONEncoder {
    static var notes: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

private extension JSONDecoder {
    static var notes: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
