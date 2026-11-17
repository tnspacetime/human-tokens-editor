import AppKit
import SwiftUI

/// Publishing one document: what the Publish pill says, and the steps of
/// its sheet. Connecting (the first time), choosing an author name (the
/// first publish ever), then the pledge and Publish. Only the document's
/// text is ever sent: self-notes live in their own file and never are.
@MainActor @Observable
final class PublishFlow {
    /// What the pill says.
    enum Pill: Equatable {
        case publish
        case published(URL)
        case update(URL)
    }

    /// Where the sheet is. nil: no sheet.
    enum Step: Equatable {
        /// An untitled document has nowhere to remember its post yet.
        case save
        /// Talking to the site.
        case working(String)
        /// Showing the code, waiting for Allow on the site.
        case connect(SiteAPI.DeviceCode)
        /// The code ran out, or you didn't allow it.
        case notConnected(String)
        /// Your first publish: how you appear on the site.
        case author
        /// The pledge, and Publish (or Update).
        case publish
        /// Something went wrong before the sheet could do anything.
        case failed(String)
    }

    private(set) var fileURL: URL?
    private(set) var record: PublishRecord?
    private var textHash = ""
    /// The document's text, as it is now.
    var text = "" {
        didSet { if text != oldValue { textHash = PublishRecord.hash(text) } }
    }

    var step: Step?
    /// An error shown in the sheet under its fields.
    var error: String?
    var busy = false

    // The author step.
    var accountName = ""
    var authorName = ""
    var handle = ""

    // The publish step.
    var preview: SiteAPI.Preview?
    var allowDebate = false
    var pledged = false

    /// Who you publish as, once known.
    private(set) var author: SiteAPI.Author?
    private var polling: Task<Void, Never>?

    var pill: Pill {
        guard let record else { return .publish }
        return record.publishedHash == textHash ? .published(record.url) : .update(record.url)
    }

    /// Published, and not changed since.
    var isUpToDate: Bool {
        if case .published = pill { true } else { false }
    }

    var isConnected: Bool { PublishToken.current != nil }
    var isUpdate: Bool { record != nil }

    // MARK: The file

    /// The document's file changed: read what it remembers, or bring the
    /// record along when it was renamed or moved.
    func setFileURL(_ url: URL?) {
        guard url != fileURL else { return }
        let previous = fileURL
        fileURL = url
        guard let url else { record = nil; return }
        if let previous, record != nil {
            let source = PublishRecord.fileURL(for: previous), destination = PublishRecord.fileURL(for: url)
            if FileManager.default.fileExists(atPath: source.path), !FileManager.default.fileExists(atPath: destination.path) {
                try? FileManager.default.moveItem(at: source, to: destination)
            }
        }
        record = PublishRecord.read(for: url).flatMap { $0.site == PublishSite.base.absoluteString ? $0 : nil }
        if step == .save { start() }
    }

    // MARK: The pill

    /// Publish, or Update.
    func start() {
        error = nil
        guard fileURL != nil else { step = .save; return }
        guard let token = PublishToken.current else { connect(); return }
        step = .working("Checking your account…")
        Task { await afterConnecting(token) }
    }

    func view() {
        if let url = record?.url { NSWorkspace.shared.open(url) }
    }

    /// Asks first: unpublishing takes its reactions and comments with it.
    func confirmUnpublish() {
        guard let record else { return }
        let alert = NSAlert()
        alert.messageText = "Unpublish “\(record.title)”?"
        alert.informativeText = "It comes off \(PublishSite.name), with its reactions and comments. The file stays on your Mac."
        alert.addButton(withTitle: "Unpublish").hasDestructiveAction = true
        alert.addButton(withTitle: "Cancel")
        let decide: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            if response == .alertFirstButtonReturn { self?.unpublish() }
        }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            alert.beginSheetModal(for: window, completionHandler: decide)
        } else {
            decide(alert.runModal())
        }
    }

    func unpublish() {
        guard let record, let fileURL, let token = PublishToken.current else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await SiteAPI.unpublish(token, postID: record.postID)
                PublishRecord.remove(for: fileURL)
                self.record = nil
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                step = .failed("This connection has ended. Click Publish to connect again, then unpublish.")
            } catch {
                step = .failed(error.localizedDescription)
            }
        }
    }

    /// Forget the token here, and end its session on the site.
    func disconnect() {
        guard let token = PublishToken.current else { return }
        PublishToken.forget()
        author = nil
        Task { await SiteAPI.disconnect(token) }
    }

    func cancel() {
        polling?.cancel()
        polling = nil
        step = nil
        error = nil
        busy = false
    }

    // MARK: Connecting

    /// Ask the site for a code, show it, and wait for Allow.
    func connect() {
        polling?.cancel()
        error = nil
        step = .working("Getting a code…")
        polling = Task {
            do {
                let code = try await SiteAPI.requestCode()
                guard !Task.isCancelled else { return }
                step = .connect(code)
                let deadline = Date().addingTimeInterval(TimeInterval(code.expires_in))
                while !Task.isCancelled, Date() < deadline {
                    try await Task.sleep(for: .seconds(max(code.interval, 1)))
                    switch try await SiteAPI.poll(code) {
                    case .waiting:
                        continue
                    case .connected(let token):
                        PublishToken.save(token)
                        step = .working("Connected. Checking your account…")
                        await afterConnecting(token)
                        return
                    case .denied:
                        step = .notConnected("You didn't allow Fold MD on the site, so it can't publish as you.")
                        return
                    case .expired:
                        break
                    }
                }
                if !Task.isCancelled { step = .notConnected("The code ran out before it was allowed.") }
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { step = .failed(error.localizedDescription) }
            }
        }
    }

    func openSite() {
        if case .connect(let code) = step { NSWorkspace.shared.open(code.verification_uri_complete) }
    }

    private func afterConnecting(_ token: String) async {
        do {
            let me = try await SiteAPI.me(token)
            guard step != nil else { return }
            author = me.author
            if me.author == nil {
                accountName = me.user.name
                if authorName.isEmpty { authorName = me.user.name }
                if handle.isEmpty { handle = Self.suggestedHandle(me.user.name) }
                step = .author
            } else {
                await showPublish(token)
            }
        } catch SiteAPI.Failure.notConnected {
            PublishToken.forget()
            connect()
        } catch {
            if step != nil { step = .failed(error.localizedDescription) }
        }
    }

    // MARK: Your author name

    func becomeAuthor() {
        guard let token = PublishToken.current else { connect(); return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                author = try await SiteAPI.becomeAuthor(token, name: authorName, handle: handle)
                await showPublish(token)
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                connect()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    static func suggestedHandle(_ name: String) -> String {
        let folded = name.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil).lowercased()
        let handle = folded.map { $0.isLetter && $0.isASCII || $0.isNumber && $0.isASCII ? String($0) : "-" }.joined()
            .split(separator: "-").joined(separator: "-")
        return String(handle.prefix(30))
    }

    // MARK: Publishing

    private func showPublish(_ token: String) async {
        pledged = false
        allowDebate = record?.allowDebate ?? false
        preview = nil
        error = nil
        step = .publish
        do {
            preview = try await SiteAPI.preview(token, markdown: text)
        } catch {
            self.error = error.localizedDescription
        }
    }

    var canPublish: Bool {
        pledged && !busy && preview?.title != nil
    }

    func publish() {
        guard canPublish, let fileURL, let token = PublishToken.current else { return }
        let markdown = text
        let sourceID = record?.sourceID ?? UUID().uuidString
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                let post = try await SiteAPI.publish(token, sourceID: sourceID, markdown: markdown, allowDebate: allowDebate)
                let record = PublishRecord(site: PublishSite.base.absoluteString, sourceID: sourceID, postID: post.id,
                                           url: post.url, title: post.title, allowDebate: post.allowDebate,
                                           publishedHash: PublishRecord.hash(markdown), publishedAt: Date())
                record.write(for: fileURL)
                self.record = record
                step = nil
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                connect()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - The pill

/// In the publishing surface's strip: Publish; once it's up, Published ·
/// View, or Update when the text has changed since. Its menu has View and
/// Unpublish.
struct PublishPill: View {
    @Bindable var flow: PublishFlow

    var body: some View {
        Group {
            if flow.busy && flow.step == nil {
                ProgressView().controlSize(.small).padding(.horizontal, 12)
            } else {
                switch flow.pill {
                case .publish:
                    Menu {
                        menuItems
                    } label: {
                        Label("Publish", systemImage: "paperplane")
                    } primaryAction: {
                        flow.start()
                    }
                    .help("Publish this piece on \(PublishSite.name)")
                case .published:
                    Menu {
                        menuItems
                    } label: {
                        Label("Published · View", systemImage: "checkmark.circle")
                    } primaryAction: {
                        flow.view()
                    }
                    .help("Open it on \(PublishSite.name). Hold for more.")
                case .update:
                    Menu {
                        menuItems
                    } label: {
                        Label("Update", systemImage: "arrow.triangle.2.circlepath")
                    } primaryAction: {
                        flow.start()
                    }
                    .help("You've changed it since it was published. Click to update the published piece.")
                }
            }
        }
        .labelStyle(.titleAndIcon)
        .fixedSize()
        // Quiet once it's up and unchanged; prominent when there's something to do.
        .publishPillStyle(prominent: !flow.isUpToDate)
    }

    @ViewBuilder private var menuItems: some View {
        if flow.record != nil {
            Button("View on \(PublishSite.name)") { flow.view() }
            Divider()
            Button("Unpublish…") { flow.confirmUnpublish() }
        } else {
            Button("Publish…") { flow.start() }
        }
        if flow.isConnected {
            Divider()
            Button("Disconnect Fold MD from \(PublishSite.name)") { flow.disconnect() }
        }
    }
}

/// The pill in the window's own toolbar, while the publishing surface is
/// closed: only once the piece is published (Published · View, or Update).
/// It shrinks and fades away as the surface opens, and back when it closes.
struct ToolbarPublishPill: View {
    @Bindable var flow: PublishFlow
    var hidden: Bool

    private var shown: Bool { !hidden && flow.record != nil }

    var body: some View {
        HStack(spacing: 0) {
            if shown {
                PublishPill(flow: flow)
                    .transition(.asymmetric(
                        insertion: .scale(scale: 0.6, anchor: .trailing).combined(with: .opacity),
                        removal: .scale(scale: 0.6, anchor: .trailing).combined(with: .opacity)))
            }
        }
        .animation(.spring(duration: 0.35, bounce: 0.2), value: shown)
    }
}

/// The window toolbar's item for it. On macOS 26 the pill is its own glass,
/// with no shared capsule behind it.
struct PublishPillToolbarItem: ToolbarContent {
    let flow: PublishFlow
    let hidden: Bool

    var body: some ToolbarContent {
        if #available(macOS 26.0, *) {
            item.sharedBackgroundVisibility(.hidden)
        } else {
            item
        }
    }

    private var item: some ToolbarContent {
        ToolbarItem { ToolbarPublishPill(flow: flow, hidden: hidden) }
    }
}

private extension View {
    @ViewBuilder func publishPillStyle(prominent: Bool) -> some View {
        if #available(macOS 26.0, *) {
            if prominent {
                self.buttonStyle(.glassProminent).controlSize(.large)
            } else {
                self.buttonStyle(.glass).controlSize(.large)
            }
        } else {
            self.menuStyle(.button).buttonStyle(.bordered).controlSize(.large)
        }
    }
}
