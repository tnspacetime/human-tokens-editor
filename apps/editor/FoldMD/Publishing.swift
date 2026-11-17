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
    }

    struct Post: Decodable, Equatable {
        let id: String
        let url: URL
        let title: String
        let allowDebate: Bool
    }

    enum Failure: LocalizedError, Equatable {
        /// No token, or the site no longer accepts it: connect again.
        case notConnected
        /// The site said no, in a sentence to show as it is.
        case refused(String, status: Int)
        /// The site couldn't be reached.
        case offline

        var errorDescription: String? {
            switch self {
            case .notConnected: "Connect Fold MD to your account first."
            case .refused(let message, _): message
            case .offline: "Couldn't reach \(PublishSite.name). Check your connection and try again."
            }
        }
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

    static func publish(_ token: String, sourceID: String, markdown: String, allowDebate: Bool) async throws -> Post {
        try await send("PUT", "api/fold/posts", body: [
            "sourceId": sourceID, "markdown": markdown, "allowDebate": allowDebate, "pledge": true,
        ], token: token)
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

    private static func send<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil,
                                           token: String? = nil) async throws -> T {
        var request = URLRequest(url: PublishSite.base.appending(path: path), timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
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

/// The post a file became: kept in a hidden file next to it
/// (".Name.md.published"), like self-notes, so the .md stays plain markdown.
struct PublishRecord: Codable, Equatable {
    var version = 1
    /// The site it's published on.
    var site: String
    /// Fold MD's id for this file: publishing it again updates the same post.
    var sourceID: String
    var postID: String
    var url: URL
    var title: String
    var allowDebate: Bool
    /// The text as published (a SHA-256), to tell when it has changed since.
    var publishedHash: String
    var publishedAt: Date

    static func fileURL(for document: URL) -> URL {
        document.deletingLastPathComponent().appending(path: ".\(document.lastPathComponent).published")
    }

    static func read(for document: URL) -> PublishRecord? {
        guard let data = try? Data(contentsOf: fileURL(for: document)) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(PublishRecord.self, from: data)
    }

    func write(for document: URL) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(self) else { return }
        try? data.write(to: Self.fileURL(for: document), options: .atomic)
    }

    static func remove(for document: URL) {
        try? FileManager.default.removeItem(at: fileURL(for: document))
    }

    static func hash(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
