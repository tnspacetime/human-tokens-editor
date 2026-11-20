import AppKit
import Foundation
import Observation
import SwiftUI

// Whether there's a newer Fold MD than this one. Fold MD is released on
// GitHub, where its code is (release.sh makes each release): every release
// carries the app as Fold-MD.zip and a small latest.json, and GitHub always
// serves the newest release's files at the same address, so the latest
// version is one fixed URL away, and releasing never touches the site.
// Fold MD asks when it opens and once a day while it's open, with nothing
// about you. When there's a newer one, a button in the toolbar says so, and
// Fold MD ▸ Check for Updates… asks at once. Fold MD doesn't replace itself:
// the button opens the release's page (what's new, and the download) and
// says how to put it in place.
//
// Versions are the app's short version (MARKETING_VERSION, "0.2"), compared
// number by number: a new build of the same version isn't offered.

@MainActor @Observable
final class Updates {
    static let shared = Updates()

    /// Where Fold MD is released.
    static let repository = URL(string: "https://github.com/tnspacetime/human-tokens-editor")!

    /// The newest release's latest.json (release.sh writes it).
    struct Release: Decodable, Equatable {
        let version: String
        /// The oldest macOS it opens on, "15.0".
        let minimumMacOS: String
        /// The release's page on GitHub: what's new, and the download.
        let page: URL
    }

    /// A newer version this Mac can run, or nil.
    private(set) var newer: Release?

    /// This copy's version, "0.1".
    static let current = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

    /// `defaults write md.fold.app updates.latest <url>` points it elsewhere, to test.
    private static var latest: URL {
        if let custom = UserDefaults.standard.string(forKey: "updates.latest"), let url = URL(string: custom) { return url }
        return repository.appending(path: "releases/latest/download/latest.json")
    }
    private static let daily: TimeInterval = 24 * 3600

    private var timer: Timer?

    /// When Fold MD opens: ask now, then once a day.
    func start() {
        guard timer == nil else { return }
        Task { try? await check() }
        timer = Timer.scheduledTimer(withTimeInterval: Self.daily, repeats: true) { _ in
            Task { @MainActor in try? await Updates.shared.check() }
        }
    }

    /// Asks GitHub; sets `newer`. Nil when nothing's been released yet;
    /// throws when GitHub couldn't be asked.
    @discardableResult
    func check() async throws -> Release? {
        var request = URLRequest(url: Self.latest, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await URLSession.shared.data(for: request)
        switch (response as? HTTPURLResponse)?.statusCode {
        case 200:
            let release = try JSONDecoder().decode(Release.self, from: data)
            newer = Self.offers(release) ? release : nil
            return release
        case 404:
            newer = nil
            return nil
        default:
            throw URLError(.badServerResponse)
        }
    }

    /// Newer than this copy, and for this Mac's macOS.
    static func offers(_ release: Release) -> Bool {
        isNewer(release.version, than: current) && runsHere(release)
    }

    static func runsHere(_ release: Release) -> Bool {
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return !isNewer(release.minimumMacOS, than: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)")
    }

    /// "0.10" is newer than "0.9"; "1.0" is the same as "1".
    static func isNewer(_ a: String, than b: String) -> Bool {
        let numbers = { (version: String) in version.split(separator: ".").map { Int($0) ?? 0 } }
        let (x, y) = (numbers(a), numbers(b))
        for index in 0..<max(x.count, y.count) {
            let (p, q) = (index < x.count ? x[index] : 0, index < y.count ? y[index] : 0)
            if p != q { return p > q }
        }
        return false
    }

    // MARK: - Saying so

    /// The toolbar button: how to put it in place, and its page.
    func offer(_ release: Release) {
        let alert = NSAlert()
        alert.messageText = "Fold MD \(release.version) is out"
        alert.informativeText = "You have \(Self.current). Its page on GitHub says what's new. Download Fold-MD.zip there, quit Fold MD, and drag the new Fold MD into Applications in place of this one. Your documents, notes and series stay as they are."
        alert.addButton(withTitle: "Open on GitHub")
        alert.addButton(withTitle: "Later")
        show(alert) { response in
            if response == .alertFirstButtonReturn { NSWorkspace.shared.open(release.page) }
        }
    }

    /// Fold MD ▸ Check for Updates…: ask now, and always answer.
    func checkNow() {
        Task {
            do {
                let release = try await check()
                if let newer {
                    offer(newer)
                    return
                }
                let alert = NSAlert()
                if let release, Self.isNewer(release.version, than: Self.current) {
                    alert.messageText = "Fold MD \(Self.current) is the latest for this Mac"
                    alert.informativeText = "Fold MD \(release.version) is out, but it needs macOS \(release.minimumMacOS.replacingOccurrences(of: #"(\.0)+$"#, with: "", options: .regularExpression)) or later."
                } else {
                    alert.messageText = "Fold MD \(Self.current) is the latest version"
                    alert.informativeText = "You'll see a button in the toolbar when there's a new one."
                }
                show(alert)
            } catch {
                let alert = NSAlert()
                alert.messageText = "Couldn't check for a new version"
                alert.informativeText = "GitHub, where Fold MD is released, didn't answer. Check your connection and try again."
                show(alert)
            }
        }
    }

    private func show(_ alert: NSAlert, then decide: @escaping (NSApplication.ModalResponse) -> Void = { _ in }) {
        if let window = NSApp.keyWindow ?? NSApp.mainWindow, window.attachedSheet == nil {
            alert.beginSheetModal(for: window, completionHandler: decide)
        } else {
            decide(alert.runModal())
        }
    }
}

/// In each window's toolbar while there's a newer version: an arrow in the
/// accent colour, saying what it is when you point at it.
struct NewVersionButton: View {
    let release: Updates.Release

    var body: some View {
        Button {
            Updates.shared.offer(release)
        } label: {
            Label("Fold MD \(release.version) is out", systemImage: "arrow.down.circle.fill")
                .foregroundStyle(.tint)
        }
        .help("Fold MD \(release.version) is out (you have \(Updates.current)). Click to get it.")
    }
}

/// Fold MD ▸ Check for Updates…, under About.
struct CheckForUpdatesCommand: Commands {
    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Check for Updates…") { Updates.shared.checkNow() }
        }
    }
}
