import AppKit
import Foundation
import Observation
import SwiftUI

// What you've published from this Mac, newest first: the date, the kind
// (post, series, reply, follow-up, P.S.) and the title. Nothing else: no
// links, so nothing here breaks when a post is deleted on the site. Each
// publish adds a line to activity.jsonl in Fold MD's own folder, which is
// never rewritten. Window ▸ Activity shows it, with Your Page at the top,
// which leads to everything you've published, from any Mac.

@MainActor @Observable
final class Activity {
    static let shared = Activity()

    enum Kind: String, Codable {
        case post, series, reply, followUp, postscript

        var label: String {
            switch self {
            case .post: "Post"
            case .series: "Series"
            case .reply: "Reply"
            case .followUp: "Follow-up"
            case .postscript: "P.S."
            }
        }
    }

    struct Entry: Codable, Identifiable, Equatable {
        let date: Date
        let kind: Kind
        /// The post's title; for a P.S., the title of the post it went under.
        let title: String
        var id: String { "\(date.timeIntervalSince1970)-\(kind.rawValue)-\(title)" }
    }

    /// Newest first.
    private(set) var entries: [Entry] = []

    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "\(AppFolder.name)/activity.jsonl")
    }

    private init() { load() }

    func record(_ kind: Kind, title: String) {
        let entry = Entry(date: .now, kind: kind, title: title)
        entries.insert(entry, at: 0)
        guard var line = try? Self.encoder.encode(entry) else { return }
        line.append(UInt8(ascii: "\n"))
        let url = Self.file
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(line)
            try? handle.close()
        } else {
            try? line.write(to: url)
        }
    }

    private func load() {
        guard let data = try? Data(contentsOf: Self.file) else { return }
        entries = data.split(separator: UInt8(ascii: "\n"))
            .compactMap { try? Self.decoder.decode(Entry.self, from: Data($0)) }
            .reversed()
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()
}

/// Your author page's handle on the site Fold MD publishes to, remembered
/// once Fold MD learns it (connecting, or becoming an author), and
/// forgotten when you disconnect.
enum YourPage {
    private static var key: String { "author.handle.\(PublishSite.name)" }

    static var handle: String? { UserDefaults.standard.string(forKey: key) }

    static func remember(_ handle: String?) {
        if let handle { UserDefaults.standard.set(handle, forKey: key) } else { UserDefaults.standard.removeObject(forKey: key) }
    }

    static var url: URL? { handle.map { PublishSite.base.appending(path: "@\($0)") } }

    /// For someone connected before Fold MD kept the handle: ask the site
    /// once, when Activity opens without one.
    @MainActor static func learnIfNeeded() async {
        guard handle == nil, let token = PublishToken.current,
              let me = try? await SiteAPI.me(token) else { return }
        remember(me.author?.handle)
    }

    static func open() {
        if let url { NSWorkspace.shared.open(url) }
    }
}

/// Window ▸ Activity.
struct ActivityWindow: View {
    private let activity = Activity.shared
    /// Read so Your Page appears as soon as Fold MD learns your handle.
    @AppStorage("author.handle.\(PublishSite.name)") private var handle: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Activity").font(.title2.weight(.semibold))
                    Text("What you've published from this Mac.").foregroundStyle(.secondary)
                }
                if let handle {
                    YourPageRow(address: "\(PublishSite.name)/@\(handle)")
                }
            }
            .padding(20)
            Divider()
            if activity.entries.isEmpty {
                Text(handle == nil
                     ? "Nothing yet. What you publish from Fold MD is listed here."
                     : "Nothing published from this Mac yet. Your Page has everything you've published.")
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(20)
            } else {
                List(activity.entries) { entry in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(entry.date.formatted(date: .abbreviated, time: .shortened))
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                            .lineLimit(1)
                            .frame(width: 180, alignment: .leading)
                        Text(entry.kind.label)
                            .foregroundStyle(.secondary)
                            .frame(width: 70, alignment: .leading)
                        Text(entry.title).lineLimit(1)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .frame(minWidth: 520, minHeight: 320)
        .task { await YourPage.learnIfNeeded() }
    }
}

/// Your Page's address, to read, select or copy, and a button to open it.
private struct YourPageRow: View {
    let address: String
    @State private var copied = false

    var body: some View {
        HStack(spacing: 10) {
            Text("Your Page").fontWeight(.medium)
            Text(address)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            Button(copied ? "Copied" : "Copy") { copy() }
                .frame(minWidth: 60)
            Button("Open") { YourPage.open() }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        .help("Everything you've published, from any Mac")
    }

    private func copy() {
        guard let url = YourPage.url else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// Opens Window ▸ Activity (from the Publish menu).
struct OpenActivityButton: View {
    @Environment(\.openWindow) private var openWindow
    var body: some View {
        Button("Activity") { openWindow(id: "activity") }
    }
}
