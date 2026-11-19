import CryptoKit
import Foundation
import Security

// Publishing to human-tokens.dev: the site's API, the token Fold MD keeps
// in the Keychain once you've connected it, and what each file remembers
// about the post it became. The flow and its sheets are in PublishFlow.swift.

/// Where Fold MD publishes. A debug build publishes to the site running on
/// this Mac (`bun run dev` in apps/site); `defaults write md.fold.app
/// publish.site <url>` points it anywhere else.
enum PublishSite {
    static var base: URL {
        if let custom = UserDefaults.standard.string(forKey: "publish.site"), let url = URL(string: custom) { return url }
        #if DEBUG
        return URL(string: "http://localhost:3100")!
        #else
        return URL(string: "https://human-tokens.dev")!
        #endif
    }

    /// "human-tokens.dev", or "localhost:3100" while developing.
    static var name: String {
        let url = base
        return [url.host(), url.port.map(String.init)].compactMap { $0 }.joined(separator: ":")
    }

    static let rules = base.appending(path: "rules")
}

// MARK: - The API

/// The site's answers, as Fold MD reads them.
enum SiteAPI {
    struct DeviceCode: Decodable, Equatable {
        let device_code: String
        let user_code: String
        let verification_uri_complete: URL
        let expires_in: Int
        let interval: Int

        /// KQ4M7TXD → KQ4M-7TXD, as the site shows it.
        var shownCode: String {
            user_code.count == 8 ? "\(user_code.prefix(4))-\(user_code.suffix(4))" : user_code
        }
    }

    struct Author: Decodable, Equatable {
        let id: String
        let handle: String
        let name: String
    }

    struct Me: Decodable, Equatable {
        struct User: Decodable, Equatable { let name: String }
        let user: User
        let author: Author?
    }

    struct Preview: Decodable, Equatable {
        let title: String?
        let opening: [String]
        let words: Int
        let minutes: Int
        /// Why you can't publish a new piece just now (too many lately), or nil.
        let limitReached: String?
        /// One of your posts with the same title or opening, or nil.
        let duplicate: Duplicate?
    }

    /// A post of yours that a new one looks like.
    struct Duplicate: Decodable, Equatable {
        let id: String
        let title: String
        let url: URL
        let publishedAt: String

        /// "12 Nov 2026".
        var shownDate: String {
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            let date = format.date(from: publishedAt) ?? ISO8601DateFormatter().date(from: publishedAt)
            return date?.formatted(date: .abbreviated, time: .omitted) ?? publishedAt
        }
    }

    struct Post: Decodable, Equatable {
        let id: String
        let url: URL
        let title: String
        /// Until when its text can still be fixed (an ISO date); nil once
        /// it's locked: after 15 minutes, or once anyone else reacts or comments.
        let fixableUntil: String?

        var fixableUntilDate: Date? {
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            return fixableUntil.flatMap(format.date(from:))
        }
    }

    enum Failure: LocalizedError, Equatable {
        /// No token, or the site no longer accepts it: connect again.
        case notConnected
        /// The site said no, in a sentence to show as it is.
        case refused(String, status: Int)
        /// The site couldn't be reached.
        case offline

        /// The piece's text is locked: its fix window has closed.
        var isLocked: Bool { if case .refused(_, 423) = self { true } else { false } }
        /// The piece isn't on the site any more.
        var isGone: Bool { if case .refused(_, 404) = self { true } else { false } }

        var errorDescription: String? {
            switch self {
            case .notConnected: "Connect Fold MD to your account first."
            case .refused(let message, _): message
            case .offline: "Couldn't reach \(PublishSite.name). Check your connection and try again."
            }
        }
    }

    /// A piece someone pasted the link of, to respond to.
    struct Piece: Decodable, Equatable {
        struct Author: Decodable, Equatable { let name: String; let handle: String }
        let id: String
        let title: String
        let url: URL
        let author: Author
        /// Yours: responding makes a follow-up. Someone else's: a reply.
        let yours: Bool
    }

    struct Postscript: Decodable, Equatable {
        let id: String
        let body: String
        let createdAt: String
    }

    /// Polling for the token after showing the code.
    enum Poll { case waiting, connected(String), denied, expired }

    static func requestCode() async throws -> DeviceCode {
        try await send("POST", "api/auth/device/code", body: ["client_id": "fold-md"])
    }

    static func poll(_ code: DeviceCode) async throws -> Poll {
        struct Token: Decodable { let access_token: String }
        do {
            let token: Token = try await send("POST", "api/auth/device/token", body: [
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": code.device_code,
                "client_id": "fold-md",
            ])
            return .connected(token.access_token)
        } catch Failure.refused(let reason, _) {
            switch reason {
            case "authorization_pending", "slow_down": return .waiting
            case "access_denied": return .denied
            default: return .expired
            }
        }
    }

    static func me(_ token: String) async throws -> Me { try await send("GET", "api/fold/me", token: token) }

    static func becomeAuthor(_ token: String, name: String, handle: String) async throws -> Author {
        struct Reply: Decodable { let author: Author }
        let reply: Reply = try await send("POST", "api/fold/author", body: ["name": name, "handle": handle], token: token)
        return reply.author
    }

    static func preview(_ token: String, markdown: String) async throws -> Preview {
        try await send("POST", "api/fold/preview", body: ["markdown": markdown], token: token)
    }

    /// `respondsTo`: the piece a new one responds to, yours (a follow-up)
    /// or anyone's (a reply).
    /// `parts`: a whole series joined into one piece, with this many chapters.
    static func publish(_ token: String, sourceID: String, markdown: String, respondsTo: String? = nil,
                        parts: Int? = nil) async throws -> Post {
        var body: [String: Any] = ["sourceId": sourceID, "markdown": markdown, "pledge": true]
        if let respondsTo { body["respondsTo"] = respondsTo }
        if let parts { body["parts"] = parts }
        return try await send("PUT", "api/fold/posts", body: body, token: token)
    }

    /// Of a piece's pictures (by hash), the ones the site doesn't have yet.
    static func missingPictures(_ token: String, hashes: [String]) async throws -> [String] {
        struct Reply: Decodable { let missing: [String] }
        let reply: Reply = try await send("POST", "api/fold/images", body: ["hashes": hashes], token: token)
        return reply.missing
    }

    /// One picture, ready (PublishPictures), sent before the piece that uses it.
    static func uploadPicture(_ token: String, _ picture: PublishPictures.Picture) async throws {
        struct Done: Decodable { let ok: Bool }
        let _: Done = try await send("PUT", "api/fold/images/\(picture.hash)", upload: (picture.data, picture.type),
                                     token: token, timeout: 120)
    }

    /// Any piece on the site, to respond to.
    static func piece(_ token: String, postID: String) async throws -> Piece {
        try await send("GET", "api/fold/pieces/\(postID)", token: token)
    }

    /// One of your posts as it stands on the site (whether it can still be fixed).
    static func post(_ token: String, postID: String) async throws -> Post {
        try await send("GET", "api/fold/posts/\(postID)", token: token)
    }

    /// A P.S. under one of your posts. It can't be edited or removed.
    static func addPostscript(_ token: String, postID: String, body: String) async throws -> Postscript {
        struct Reply: Decodable { let postscript: Postscript }
        let reply: Reply = try await send("POST", "api/fold/posts/\(postID)/ps", body: ["body": body, "pledge": true], token: token)
        return reply.postscript
    }

    static func unpublish(_ token: String, postID: String) async throws {
        struct Done: Decodable { let ok: Bool }
        do {
            let _: Done = try await send("DELETE", "api/fold/posts/\(postID)", token: token)
        } catch Failure.refused(_, status: 404) {
            // Already gone.
        }
    }

    /// Ends the session the token is for, on the site.
    static func disconnect(_ token: String) async {
        struct Done: Decodable {}
        let _: Done? = try? await send("POST", "api/auth/sign-out", body: [:], token: token)
    }

    /// "Fold MD/1.0 (Ana's MacBook Air)": the site lists where Fold MD is
    /// connected by it, so you can disconnect a Mac you don't use any more.
    /// Only plain letters go as they are; the rest is %-encoded.
    private static let userAgent: String = {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1"
        let name = Host.current().localizedName ?? "Mac"
        let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.")
        return "Fold MD/\(version) (\(name.addingPercentEncoding(withAllowedCharacters: plain) ?? "Mac"))"
    }()

    /// `body` goes as JSON; `upload` as the bytes they are, of that type.
    private static func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil,
                                           upload: (data: Data, type: String)? = nil,
                                           token: String? = nil, timeout: TimeInterval = 20) async throws -> T {
        var request = URLRequest(url: PublishSite.base.appending(path: path), timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } else if let upload {
            request.setValue(upload.type, forHTTPHeaderField: "Content-Type")
            request.httpBody = upload.data
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        // No cookies: only the token says who's publishing.
        request.httpShouldHandleCookies = false

        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure.offline
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(status), let value = try? JSONDecoder().decode(T.self, from: data) { return value }
        if status == 401 && token != nil { throw Failure.notConnected }
        // Our API says { error: "A sentence." }; the device endpoints say
        // { error: "code", error_description: "…" }.
        let refusal = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let message = refusal?["error"] as? String ?? "Something went wrong on \(PublishSite.name) (\(status)). Try again."
        throw Failure.refused(message, status: status)
    }
}

// MARK: - The token

/// The token Fold MD publishes with, in your login Keychain (one per site).
@MainActor
enum PublishToken {
    private static let service = "md.fold.app.human-tokens"
    /// Read once per launch, so the Keychain isn't asked on every click.
    private static var cache: [String: String?] = [:]

    static var current: String? {
        let account = PublishSite.name
        if let cached = cache[account] { return cached }
        var result: AnyObject?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
        ] as CFDictionary, &result)
        let token = status == errSecSuccess ? (result as? Data).flatMap { String(data: $0, encoding: .utf8) } : nil
        cache[account] = token
        return token
    }

    static func save(_ token: String) {
        let account = PublishSite.name
        let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary
        SecItemDelete(query)
        SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrLabel: "Fold MD · \(account)",
            kSecValueData: Data(token.utf8),
        ] as CFDictionary, nil)
        cache[account] = token
    }

    static func forget() {
        let account = PublishSite.name
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] as CFDictionary)
        cache[account] = .some(nil)
    }
}

// MARK: - What a file remembers

/// The post a file (or a series) became, kept in Fold MD's own folder
/// (see PublishedFiles), so your folders hold only your markdown. Only for
/// its fix window: then it's removed, and the file is just a file.
struct PublishRecord: Codable, Equatable {
    var version = 1
    /// The site it's published on.
    var site: String
    /// Fold MD's id for this file: publishing it again updates the same post.
    var sourceID: String
    var postID: String
    var url: URL
    var title: String
    /// The text and its pictures as published (PublishFlow.fingerprint), to
    /// tell when either has changed since.
    var publishedHash: String
    var publishedAt: Date
    /// Until when it can still be fixed, as the site last said; nil once
    /// it's locked.
    var fixableUntil: Date?

    /// Still in its fix window.
    var isFixable: Bool { (fixableUntil ?? .distantPast) > .now }
    /// The file it was published from: where it was last seen, and a macOS
    /// bookmark that keeps finding it after it's renamed or moved. (None
    /// for a series, whose record is named after it.)
    var path: String?
    var bookmark: Data?

    /// Where Fold MD keeps what it published.
    static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "Fold MD/published")
    }

    /// Where a series' record lives: named after the series.
    static func fileURL(forSeries id: Series.ID) -> URL {
        folder.appending(path: "series-\(id.uuidString).json")
    }

    /// Where a file's record used to live: in a hidden file beside it.
    static func legacyURL(for document: URL) -> URL {
        document.deletingLastPathComponent().appending(path: ".\(document.lastPathComponent).published")
    }

    static func read(at location: URL) -> PublishRecord? {
        guard let data = try? Data(contentsOf: location) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(PublishRecord.self, from: data)
    }

    func write(to location: URL) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(self) else { return }
        try? FileManager.default.createDirectory(at: location.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: location, options: .atomic)
    }

    static func remove(at location: URL) {
        try? FileManager.default.removeItem(at: location)
    }

    static func hash(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// The records of published files, in Fold MD's own folder
/// (Application Support/Fold MD/published/file-<id>.json), read once and
/// kept in memory. A record finds its file by path, or by its bookmark
/// when the file was renamed or moved while Fold MD wasn't looking.
@MainActor
enum PublishedFiles {
    private static var cache: [URL: PublishRecord]?

    /// Where a file that hasn't been published yet will keep its record.
    static func newLocation() -> URL {
        PublishRecord.folder.appending(path: "file-\(UUID().uuidString).json")
    }

    /// This document's record for `site`, if it has one.
    static func find(for document: URL, site: String) -> (location: URL, record: PublishRecord)? {
        if let adopted = adoptLegacy(for: document, site: site) { return adopted }
        let path = document.standardizedFileURL.path
        let mine = all().filter { $0.value.site == site }
        if let hit = mine.first(where: { $0.value.path == path }) { return (hit.key, hit.value) }
        // Renamed or moved since: ask the bookmarks of records whose file
        // isn't where it was.
        for (location, record) in mine where !(record.path.map(FileManager.default.fileExists(atPath:)) ?? false) {
            guard let data = record.bookmark else { continue }
            var stale = false
            guard let url = try? URL(resolvingBookmarkData: data, options: [.withoutUI, .withoutMounting],
                                     relativeTo: nil, bookmarkDataIsStale: &stale),
                  url.standardizedFileURL.path == path else { continue }
            var moved = record
            stamp(&moved, file: document)
            write(moved, to: location)
            return (location, moved)
        }
        return nil
    }

    /// Note where the file is now.
    static func stamp(_ record: inout PublishRecord, file: URL) {
        record.path = file.standardizedFileURL.path
        record.bookmark = try? file.bookmarkData()
    }

    static func write(_ record: PublishRecord, to location: URL) {
        record.write(to: location)
        if isFileRecord(location) { cache?[location] = record }
    }

    static func remove(at location: URL) {
        PublishRecord.remove(at: location)
        cache?[location] = nil
    }

    private static func isFileRecord(_ location: URL) -> Bool {
        location.lastPathComponent.hasPrefix("file-") && location.pathExtension == "json"
    }

    /// The records of posts that can still be fixed. The rest (and those of
    /// series) are removed as they're found: Fold MD lets go of a post once
    /// its fix window has closed.
    private static func all() -> [URL: PublishRecord] {
        if let cache { return cache }
        let urls = (try? FileManager.default.contentsOfDirectory(at: PublishRecord.folder, includingPropertiesForKeys: nil)) ?? []
        var found: [URL: PublishRecord] = [:]
        for url in urls where url.pathExtension == "json" {
            guard let record = PublishRecord.read(at: url), record.isFixable else {
                PublishRecord.remove(at: url)
                continue
            }
            if isFileRecord(url) { found[url] = record }
        }
        cache = found
        return found
    }

    /// A record from before, in a hidden file beside the document: move it
    /// into Fold MD's folder and remove the hidden file.
    private static func adoptLegacy(for document: URL, site: String) -> (location: URL, record: PublishRecord)? {
        let old = PublishRecord.legacyURL(for: document)
        guard var record = PublishRecord.read(at: old) else { return nil }
        stamp(&record, file: document)
        let location = newLocation()
        _ = all()
        write(record, to: location)
        guard FileManager.default.fileExists(atPath: location.path) else { return nil }
        try? FileManager.default.removeItem(at: old)
        return record.site == site ? (location, record) : nil
    }
}
