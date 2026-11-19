import AppKit
import Foundation

/// A whole series, put together as one piece to publish: the series' title,
/// then each part in order as a chapter. A part's own "# Title" becomes its
/// chapter heading ("## Title") and its other headings move down one level,
/// so the site can list the chapters at the top. Self-notes never go: they
/// live in their own files.
@MainActor
enum SeriesJoin {
    enum Problem: LocalizedError {
        case empty
        case missing([String])

        var errorDescription: String? {
            switch self {
            case .empty: "This series has no parts yet."
            case .missing(let names):
                names.count == 1
                    ? "“\(names[0])” can't be found. Find it, or take it out of the series, then publish."
                    : "\(names.count) parts can't be found. Find them, or take them out of the series, then publish."
            }
        }
    }

    /// The series as one piece, from its parts as they are now (open
    /// documents with unsaved changes are saved first, unless `saveOpen` is
    /// false: then as they are on disk).
    static func join(_ id: Series.ID, saveOpen: Bool = true) async throws -> (markdown: String, parts: Int) {
        let library = SeriesLibrary.shared
        guard let series = library.series(id), !series.parts.isEmpty else { throw Problem.empty }
        let urls = series.parts.map { library.url(for: $0) }
        let missing = zip(series.parts, urls).filter { $0.1 == nil }
            .map { URL(fileURLWithPath: $0.0.lastKnownPath).deletingPathExtension().lastPathComponent }
        guard missing.isEmpty else { throw Problem.missing(missing) }

        if saveOpen { await saveOpenParts(urls.compactMap { $0 }) }
        var chapters: [String] = []
        for url in urls.compactMap({ $0 }) {
            let text = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            // Its pictures' links start from its own folder.
            let part = PublishPictures.absolutize(text, base: url.deletingLastPathComponent())
            chapters.append(chapter(part, fallbackTitle: url.deletingPathExtension().lastPathComponent))
        }
        let markdown = "# \(series.title)\n\n" + chapters.joined(separator: "\n\n")
        return (markdown, chapters.count)
    }

    /// The series' parts as files (which, and when each was last saved): it
    /// changes when a part is saved, added, removed or moved. Cheap: no
    /// file is read.
    static func stamp(_ id: Series.ID) -> String {
        let library = SeriesLibrary.shared
        guard let series = library.series(id) else { return "" }
        return series.parts.map { part -> String in
            guard let url = library.url(for: part) else { return "missing" }
            let saved = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            return "\(url.path)|\(saved?.timeIntervalSince1970 ?? 0)"
        }.joined(separator: "\n")
    }

    /// Open parts with unsaved changes: save them, so what's published is
    /// what you see.
    private static func saveOpenParts(_ urls: [URL]) async {
        let keys = Set(urls.map(SeriesLibrary.key))
        for document in NSDocumentController.shared.documents where document.isDocumentEdited {
            guard let url = document.fileURL, let type = document.fileType, keys.contains(SeriesLibrary.key(url)) else { continue }
            try? await document.save(to: url, ofType: type, for: .saveOperation)
        }
    }

    /// One part as a chapter: its first "# Title" becomes "## Title" (or its
    /// file name does, when it has none), every other heading moves down a
    /// level (to "###" at least, so only chapters are "##"), and nothing
    /// inside code blocks changes.
    static func chapter(_ text: String, fallbackTitle: String) -> String {
        var lines = text.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        var fence: Character?
        var tookTitle = false
        for index in lines.indices {
            let line = lines[index]
            let indent = line.prefix { $0 == " " }.count
            guard indent < 4 else { continue }
            let rest = line.dropFirst(indent)
            if let marker = rest.first, marker == "`" || marker == "~", rest.hasPrefix(String(repeating: marker, count: 3)) {
                if fence == nil { fence = marker } else if fence == marker { fence = nil }
                continue
            }
            guard fence == nil, rest.first == "#" else { continue }
            let level = rest.prefix { $0 == "#" }.count
            let after = rest.dropFirst(level)
            guard level <= 6, after.isEmpty || after.first == " " || after.first == "\t" else { continue }
            let isTitle = level == 1 && !tookTitle
            if isTitle { tookTitle = true }
            lines[index] = String(repeating: "#", count: isTitle ? 2 : min(max(level + 1, 3), 6)) + after
        }
        var chapter = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !tookTitle { chapter = "## \(fallbackTitle)\n\n" + chapter }
        return chapter
    }
}
