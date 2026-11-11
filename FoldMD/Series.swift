import AppKit
import Foundation
import Observation

/// One file in a series. The file itself stays wherever it is; the series
/// only points at it.
struct SeriesPart: Codable, Identifiable, Hashable {
    var id = UUID()
    /// A macOS bookmark: keeps finding the file after it's moved or renamed.
    var bookmark: Data?
    /// Where the file was last seen, for finding it without a bookmark and
    /// for explaining what's missing.
    var lastKnownPath: String
}

/// An ordered list of markdown files, for viewing and publishing together.
struct Series: Codable, Identifiable, Hashable {
    var id = UUID()
    var title: String
    var parts: [SeriesPart] = []
    var created = Date()
    var updated = Date()
}

/// What the publishing surface shows around a part of a series.
struct SeriesNavigation: Equatable {
    struct Neighbour: Equatable {
        var title: String
        var path: String
    }
    var seriesID: Series.ID
    var title: String
    var index: Int // 1-based
    var count: Int
    var previous: Neighbour?
    var next: Neighbour?
}

/// All series, kept inside the app (Application Support/Fold MD/series.json).
/// Deleting a series deletes only this record; the files stay where they are.
@MainActor
@Observable
final class SeriesLibrary {
    static let shared = SeriesLibrary()

    private(set) var all: [Series] = []

    /// A request to show a series in the window whose document is at `path`
    /// (set just before opening a part from the sidebar or the page).
    private(set) var reveal: (path: String, seriesID: Series.ID, token: UUID)?

    @ObservationIgnored private let storeURL: URL
    @ObservationIgnored private var titleCache: [String: (modified: Date, title: String)] = [:]

    init(storeURL: URL? = nil) {
        self.storeURL = storeURL ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "Fold MD/series.json")
        load()
    }

    /// Most recently edited first.
    var recent: [Series] { all.sorted { $0.updated > $1.updated } }

    func series(_ id: Series.ID) -> Series? { all.first { $0.id == id } }

    // MARK: Editing

    @discardableResult
    func create(title: String = "Untitled Series", with urls: [URL] = []) -> Series.ID {
        var series = Series(title: title)
        series.parts = urls.map(Self.part(for:))
        all.append(series)
        save()
        return series.id
    }

    func rename(_ id: Series.ID, to title: String) {
        update(id) { $0.title = title }
    }

    func delete(_ id: Series.ID) {
        all.removeAll { $0.id == id }
        save()
    }

    /// Adds files to the end of a series (or at `index`), skipping ones it
    /// already has. Only markdown files are added.
    func add(_ urls: [URL], to id: Series.ID, at index: Int? = nil) {
        update(id) { series in
            let existing = Set(series.parts.compactMap { self.url(for: $0).map(Self.key) })
            var seen = existing
            let new = urls
                .filter { Self.isMarkdown($0) }
                .filter { seen.insert(Self.key($0)).inserted }
                .map(Self.part(for:))
            let at = min(index ?? series.parts.count, series.parts.count)
            series.parts.insert(contentsOf: new, at: at)
        }
    }

    func remove(_ partID: SeriesPart.ID, from id: Series.ID) {
        update(id) { $0.parts.removeAll { $0.id == partID } }
    }

    func move(from source: IndexSet, to destination: Int, in id: Series.ID) {
        update(id) { series in
            // Same semantics as List's onMove (destination is before removal).
            let moving = source.map { series.parts[$0] }
            for index in source.reversed() { series.parts.remove(at: index) }
            let target = destination - source.filter { $0 < destination }.count
            series.parts.insert(contentsOf: moving, at: min(max(0, target), series.parts.count))
        }
    }

    /// Points a part at a file's new location ("Locate…").
    func relocate(_ partID: SeriesPart.ID, in id: Series.ID, to url: URL) {
        update(id) { series in
            guard let index = series.parts.firstIndex(where: { $0.id == partID }) else { return }
            series.parts[index] = Self.part(for: url, id: partID)
        }
    }

    /// Marks a series as just edited (so it's first in the list), at most
    /// once a minute while you type.
    func touch(_ id: Series.ID) {
        guard let series = series(id), Date().timeIntervalSince(series.updated) > 60 else { return }
        update(id) { _ in }
    }

    /// Updates bookmarks that macOS reports as out of date, and the last
    /// known paths of files that moved. Call when showing the sidebar.
    func refreshLocations() {
        var changed = false
        for s in all.indices {
            for p in all[s].parts.indices {
                let part = all[s].parts[p]
                guard let url = url(for: part) else { continue }
                if url.path != part.lastKnownPath || isStale(part) {
                    all[s].parts[p] = Self.part(for: url, id: part.id)
                    changed = true
                }
            }
        }
        if changed { save() }
    }

    func requestReveal(of seriesID: Series.ID, at url: URL) {
        reveal = (Self.key(url), seriesID, UUID())
    }

    func consumeReveal() {
        reveal = nil
    }

    // MARK: Looking things up

    /// The file a part points at, or nil if it can't be found (or is in the Trash).
    func url(for part: SeriesPart) -> URL? {
        if let data = part.bookmark {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI, .withoutMounting],
                                  relativeTo: nil, bookmarkDataIsStale: &stale),
               Self.isAvailable(url) {
                return url
            }
        }
        let url = URL(fileURLWithPath: part.lastKnownPath)
        return Self.isAvailable(url) ? url : nil
    }

    /// Series that include this file.
    func series(containing url: URL) -> [Series] {
        let key = Self.key(url)
        return recent.filter { series in series.parts.contains { self.url(for: $0).map(Self.key) == key } }
    }

    /// A part's title: the file's first "# Heading", or its name.
    func title(of url: URL) -> String {
        let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
        if let cached = titleCache[url.path], cached.modified == modified { return cached.title }
        let title = Self.readTitle(url)
        titleCache[url.path] = (modified, title)
        return title
    }

    func navigation(for url: URL, currentTitle: String) -> SeriesNavigation? {
        guard let series = series(containing: url).first else { return nil }
        let key = Self.key(url)
        let urls = series.parts.map(self.url(for:))
        guard let index = urls.firstIndex(where: { $0.map(Self.key) == key }) else { return nil }
        func neighbour(_ i: Int) -> SeriesNavigation.Neighbour? {
            guard urls.indices.contains(i), let url = urls[i] else { return nil }
            return .init(title: title(of: url), path: url.path)
        }
        return SeriesNavigation(seriesID: series.id, title: series.title, index: index + 1, count: series.parts.count,
                                previous: neighbour(index - 1), next: neighbour(index + 1))
    }

    // MARK: Helpers

    static func isMarkdown(_ url: URL) -> Bool {
        ["md", "markdown", "mdown"].contains(url.pathExtension.lowercased())
    }

    /// Compares files by their real location.
    static func key(_ url: URL) -> String {
        url.standardizedFileURL.resolvingSymlinksInPath().path
    }

    static func readTitle(_ url: URL) -> String {
        var text = ""
        if let handle = try? FileHandle(forReadingFrom: url) {
            text = String(decoding: (try? handle.read(upToCount: 16_384)) ?? Data(), as: UTF8.self)
            try? handle.close()
        }
        return firstHeading(in: text) ?? url.deletingPathExtension().lastPathComponent
    }

    /// The first "# Heading" (level one, outside code blocks), if any.
    static func firstHeading(in text: String) -> String? {
        var inFence = false
        for line in text.split(separator: "\n", omittingEmptySubsequences: true).prefix(60) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inFence.toggle(); continue }
            if !inFence, trimmed.hasPrefix("# ") {
                let heading = trimmed.dropFirst(2).trimmingCharacters(in: .whitespaces)
                if !heading.isEmpty { return heading }
            }
        }
        return nil
    }

    private static func isAvailable(_ url: URL) -> Bool {
        !url.path.contains("/.Trash/") && FileManager.default.fileExists(atPath: url.path)
    }

    private static func part(for url: URL) -> SeriesPart {
        part(for: url, id: UUID())
    }

    private static func part(for url: URL, id: SeriesPart.ID) -> SeriesPart {
        SeriesPart(id: id, bookmark: try? url.bookmarkData(), lastKnownPath: url.path)
    }

    private func isStale(_ part: SeriesPart) -> Bool {
        guard let data = part.bookmark else { return true }
        var stale = false
        _ = try? URL(resolvingBookmarkData: data, options: [.withoutUI, .withoutMounting],
                     relativeTo: nil, bookmarkDataIsStale: &stale)
        return stale
    }

    private func update(_ id: Series.ID, _ change: (inout Series) -> Void) {
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        change(&all[index])
        all[index].updated = Date()
        save()
    }

    // MARK: Storage

    private func load() {
        guard let data = try? Data(contentsOf: storeURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        all = (try? decoder.decode([Series].self, from: data)) ?? []
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(all) else { return }
        try? FileManager.default.createDirectory(at: storeURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storeURL, options: .atomic)
    }
}
