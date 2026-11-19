import AppKit
import SwiftUI

/// Publishing one document: what the Publish pill says, and the steps of
/// its sheet. Connecting (the first time), choosing an author name (the
/// first publish ever), then the pledge and Publish. Only the document's
/// text is ever sent: self-notes live in their own file and never are.
///
/// Once published, a piece can be fixed only in its fix window (15 minutes,
/// and until anyone reacts or comments); then its text is locked, so what
/// readers reacted to stays what's there. The site enforces it. To say more
/// after that, you write a new piece and, as you publish it, paste the
/// earlier piece's link: the new one is then its follow-up.
@MainActor @Observable
final class PublishFlow {
    /// What the pill says.
    enum Pill: Equatable {
        case publish
        /// Up, and either unchanged or locked.
        case published(URL)
        /// Changed since, and still in its fix window.
        case fix(URL)
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
        /// The pledge, and Publish (or Fix).
        case publish
        /// You tried to fix it, but its text is locked now.
        case locked
        /// Writing a P.S. under the published piece.
        case postscript
        /// The P.S. is up.
        case postscriptAdded
        /// Something went wrong before the sheet could do anything.
        case failed(String)
    }

    private(set) var fileURL: URL?
    /// Where this file's (or series') record of its post lives.
    private(set) var recordURL: URL?

    /// Publishing a whole series: how many parts, and how to put them
    /// together into one piece (read fresh each time). nil for a file.
    private(set) var parts: Int?
    @ObservationIgnored private var joinParts: (() async throws -> (markdown: String, parts: Int))?
    var isSeries: Bool { joinParts != nil }
    private(set) var record: PublishRecord?
    private var textHash = ""
    /// The document's text, as it is now.
    var text = "" {
        didSet {
            guard text != oldValue else { return }
            textHash = PublishRecord.hash(text)
            if case .fix = pill { checkFixWindow() }
        }
    }

    var step: Step?
    /// An error shown in the sheet under its fields.
    var error: String?
    var busy = false
    /// What a long publish is doing now (its pictures), for the button.
    private(set) var progress: String?

    /// The pictures on this Mac the piece links (each file once).
    var pictureCount: Int {
        PublishPictures.count(in: text, base: isSeries ? nil : fileURL?.deletingLastPathComponent())
    }

    // The author step.
    var accountName = ""
    var authorName = ""
    var handle = ""

    // The publish step.
    var preview: SiteAPI.Preview?
    var pledged = false

    // A response: the link of the piece this new one responds to
    // (optional): one of yours makes it a follow-up, anyone else's a reply.
    // Then that piece, once the site has found it.
    var respondsToLink = "" {
        didSet { if respondsToLink != oldValue { findPiece() } }
    }
    private(set) var respondsTo: SiteAPI.Piece?
    private(set) var respondsToProblem: String?
    private var finding: Task<Void, Never>?

    // The P.S. step. What you've typed stays until it's added.
    var postscript = ""
    var postscriptPledged = false
    /// A P.S. is short: anything longer belongs in a follow-up.
    static let postscriptMaxWords = 150
    var postscriptWords: Int { postscript.split(whereSeparator: \.isWhitespace).count }

    /// Where the sheet goes once connected.
    private enum Goal { case publish, postscript }
    private var goal = Goal.publish

    /// Who you publish as, once known.
    private(set) var author: SiteAPI.Author?
    private var polling: Task<Void, Never>?

    /// Still in the fix window, as far as Fold MD knows. Turns false on its
    /// own when the window's time runs out; the site can close it sooner
    /// (a reaction or a comment), which Fold MD hears when it checks.
    private(set) var fixable = false
    private var windowClosing: Task<Void, Never>?
    private var lastCheck = Date.distantPast

    var pill: Pill {
        guard let record else { return .publish }
        if record.publishedHash == textHash || !fixable { return .published(record.url) }
        return .fix(record.url)
    }

    /// Published, changed since, and locked: the changes stay on this Mac.
    var hasLockedChanges: Bool {
        guard let record else { return false }
        return record.publishedHash != textHash && !fixable
    }

    /// Published, and not changed since.
    var isUpToDate: Bool {
        if case .published = pill { true } else { false }
    }

    var isConnected: Bool { PublishToken.current != nil }
    /// Publishing again fixes the piece it already is.
    var isFix: Bool { record != nil }

    /// When the fix window closes, if it's still open.
    var fixableUntil: Date? { fixable ? record?.fixableUntil : nil }

    // MARK: The file

    /// The document's file changed: find what it was published as, or note
    /// where the file is now when it was renamed or moved.
    func setFileURL(_ url: URL?) {
        guard url != fileURL else { return }
        let previous = fileURL
        fileURL = url
        guard let url else { recordURL = nil; record = nil; updateFixable(); return }
        if previous != nil, let record, let recordURL {
            keep(record, at: recordURL)
        } else {
            let found = PublishedFiles.find(for: url, site: PublishSite.base.absoluteString)
            recordURL = found?.location ?? PublishedFiles.newLocation()
            record = found?.record
        }
        updateFixable()
        if step == .save { start() }
    }

    /// Save the record, noting where its file is now (a file's, not a series').
    private func keep(_ record: PublishRecord, at location: URL) {
        var record = record
        if !isSeries, let fileURL { PublishedFiles.stamp(&record, file: fileURL) }
        PublishedFiles.write(record, to: location)
        self.record = record
    }

    // MARK: A series

    /// A flow for publishing a whole series, set up from the start.
    convenience init(series id: Series.ID) {
        self.init()
        setSeries(id) { try await SeriesJoin.join(id) }
    }

    /// Publish a whole series as one piece: `join` puts its parts together.
    func setSeries(_ id: Series.ID, join: @escaping () async throws -> (markdown: String, parts: Int)) {
        let location = PublishRecord.fileURL(forSeries: id)
        joinParts = join
        guard location != recordURL else { return }
        recordURL = location
        record = PublishRecord.read(at: location).flatMap { $0.site == PublishSite.base.absoluteString ? $0 : nil }
        updateFixable()
    }

    /// Put the series' parts together again, to tell whether it's changed
    /// since it was published.
    func refreshSeries() async {
        guard let joinParts, let joined = try? await joinParts() else { return }
        text = joined.markdown
        parts = joined.parts
    }

    // MARK: The pill

    /// Publish, or Fix.
    func start() {
        goal = .publish
        error = nil
        guard recordURL != nil else { step = .save; return }
        if let joinParts {
            // A series: put the parts together first, as they are now.
            step = .working("Putting the parts together…")
            Task {
                do {
                    let joined = try await joinParts()
                    text = joined.markdown
                    parts = joined.parts
                } catch {
                    step = .failed(error.localizedDescription)
                    return
                }
                guard step != nil else { return }
                continueStart()
            }
            return
        }
        continueStart()
    }

    private func continueStart() {
        if record != nil && !fixable { step = .locked; return }
        guard let token = PublishToken.current else { connect(); return }
        step = .working("Checking your account…")
        Task { await afterConnecting(token) }
    }

    func view() {
        if let url = record?.url { NSWorkspace.shared.open(url) }
    }

    /// The piece's link, to paste where a new piece asks what it responds to.
    func copyLink() {
        guard let url = record?.url else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(url.absoluteString, forType: .string)
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
        guard let record, let recordURL, let token = PublishToken.current else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await SiteAPI.unpublish(token, postID: record.postID)
                PublishedFiles.remove(at: recordURL)
                self.record = nil
                updateFixable()
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
            if goal == .postscript, me.author != nil {
                goal = .publish
                showPostscript()
            } else if me.author == nil {
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

    // MARK: A response

    /// The post id in a link like https://human-tokens.dev/p/AbC123xy/its-title.
    static func postID(in link: String) -> String? {
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = text.firstMatch(of: /\/p\/([0-9A-Za-z]{6,16})(?:[\/?#]|$)/) else { return nil }
        return String(match.1)
    }

    /// Look up the pasted link: any piece on the site.
    private func findPiece() {
        finding?.cancel()
        respondsTo = nil
        respondsToProblem = nil
        let link = respondsToLink.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !link.isEmpty else { return }
        guard let id = Self.postID(in: link) else {
            respondsToProblem = "Paste the link of a piece, like \(PublishSite.name)/p/…"
            return
        }
        guard let token = PublishToken.current else { return }
        finding = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            do {
                let piece = try await SiteAPI.piece(token, postID: id)
                guard !Task.isCancelled else { return }
                respondsTo = piece
            } catch let failure as SiteAPI.Failure where failure.isGone {
                if !Task.isCancelled { respondsToProblem = "That piece isn't on \(PublishSite.name)." }
            } catch {
                if !Task.isCancelled { respondsToProblem = error.localizedDescription }
            }
        }
    }

    // MARK: A P.S.

    /// Add a P.S. under the published piece.
    func startPostscript() {
        guard record != nil else { return }
        goal = .postscript
        error = nil
        guard let token = PublishToken.current else { connect(); return }
        step = .working("Checking your account…")
        Task { await afterConnecting(token) }
    }

    private func showPostscript() {
        postscriptPledged = false
        error = nil
        step = .postscript
    }

    var canAddPostscript: Bool {
        postscriptPledged && !busy && postscriptWords > 0 && postscriptWords <= Self.postscriptMaxWords
    }

    func addPostscript() {
        guard canAddPostscript, let record, let token = PublishToken.current else { return }
        let body = postscript
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                _ = try await SiteAPI.addPostscript(token, postID: record.postID, body: body)
                postscript = ""
                postscriptPledged = false
                step = .postscriptAdded
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                goal = .postscript
                connect()
            } catch let failure as SiteAPI.Failure where failure.isGone {
                forgetGonePost()
                step = .failed("This piece isn't on the site any more, so the P.S. couldn't be added.")
            } catch {
                self.error = error.localizedDescription
            }
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

    // MARK: The fix window

    private func updateFixable() {
        windowClosing?.cancel()
        guard let until = record?.fixableUntil, until > .now else { fixable = false; return }
        fixable = true
        windowClosing = Task { [weak self] in
            try? await Task.sleep(for: .seconds(until.timeIntervalSinceNow + 0.5))
            guard !Task.isCancelled else { return }
            self?.updateFixable()
        }
    }

    /// Remember what the site says about the piece now.
    private func apply(_ post: SiteAPI.Post) {
        guard var record, let recordURL, record.postID == post.id else { return }
        record.fixableUntil = post.fixableUntilDate
        keep(record, at: recordURL)
        updateFixable()
    }

    private func markLocked() {
        guard var record, let recordURL else { return }
        record.fixableUntil = nil
        keep(record, at: recordURL)
        updateFixable()
    }

    /// While the pill offers Fix, ask the site now and then whether someone
    /// has reacted or commented since, which locks it.
    private func checkFixWindow() {
        guard let record, Date.now.timeIntervalSince(lastCheck) > 20, let token = PublishToken.current else { return }
        lastCheck = .now
        Task {
            do {
                apply(try await SiteAPI.post(token, postID: record.postID))
            } catch let failure as SiteAPI.Failure where failure.isGone {
                forgetGonePost()
            } catch {}
        }
    }

    /// Unpublished on the site: this file can be published afresh.
    private func forgetGonePost() {
        guard let recordURL else { return }
        PublishedFiles.remove(at: recordURL)
        record = nil
        updateFixable()
    }

    // MARK: Publishing

    private func showPublish(_ token: String) async {
        if let record {
            // Fixing: make sure it still can be.
            do {
                apply(try await SiteAPI.post(token, postID: record.postID))
                if !fixable { step = .locked; return }
            } catch let failure as SiteAPI.Failure where failure.isGone {
                forgetGonePost()
            } catch {
                if step != nil { step = .failed(error.localizedDescription) }
                return
            }
        }
        pledged = false
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
        // A pasted link has to be found first (or cleared).
        let respondsToReady = isFix || respondsToLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || respondsTo != nil
        // A fix doesn't count as a new piece.
        let underLimit = isFix || preview?.limitReached == nil
        return pledged && !busy && preview?.title != nil && respondsToReady && underLimit
    }

    func publish() {
        guard canPublish, let recordURL, let token = PublishToken.current else { return }
        let markdown = text
        // A series' parts link their pictures absolutely (SeriesJoin).
        let base = isSeries ? nil : fileURL?.deletingLastPathComponent()
        let sourceID = record?.sourceID ?? UUID().uuidString
        // Only a new piece can respond to another.
        let respondsToID = isFix ? nil : respondsTo?.id
        busy = true
        error = nil
        Task {
            defer { busy = false; progress = nil }
            do {
                // Pictures first: made ready on this Mac, then the ones the
                // site doesn't have yet are sent. The piece links them by hash.
                if pictureCount > 0 { progress = "Getting pictures ready…" }
                let ready = try await Task.detached(priority: .userInitiated) {
                    try PublishPictures.ready(markdown, base: base)
                }.value
                if !ready.pictures.isEmpty {
                    let missing = Set(try await SiteAPI.missingPictures(token, hashes: ready.pictures.map(\.hash)))
                    let sending = ready.pictures.filter { missing.contains($0.hash) }
                    for (index, picture) in sending.enumerated() {
                        progress = sending.count == 1 ? "Sending the picture…" : "Sending pictures (\(index + 1) of \(sending.count))…"
                        try await SiteAPI.uploadPicture(token, picture)
                    }
                    progress = nil
                }
                let post = try await SiteAPI.publish(token, sourceID: sourceID, markdown: ready.markdown, respondsTo: respondsToID, parts: parts)
                let record = PublishRecord(site: PublishSite.base.absoluteString, sourceID: sourceID, postID: post.id,
                                           url: post.url, title: post.title,
                                           publishedHash: PublishRecord.hash(markdown), publishedAt: Date(),
                                           fixableUntil: post.fixableUntilDate)
                keep(record, at: recordURL)
                updateFixable()
                respondsToLink = ""
                step = nil
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                connect()
            } catch let failure as SiteAPI.Failure where failure.isLocked {
                markLocked()
                step = .locked
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - The pill

/// In the publishing surface's strip: Publish; once it's up, Published ·
/// View, or Fix when the text has changed in its fix window. Its menu has
/// View and Unpublish.
struct PublishPill: View {
    @Bindable var flow: PublishFlow
    /// Large in the toolbar; smaller at the foot of the series sidebar.
    var size: ControlSize = .large

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
                    .help(flow.hasLockedChanges
                          ? "Open it on \(PublishSite.name). Its text is locked, so your changes since publishing stay on your Mac."
                          : "Open it on \(PublishSite.name). Hold for more.")
                case .fix:
                    Menu {
                        menuItems
                    } label: {
                        Label("Fix", systemImage: "pencil")
                    } primaryAction: {
                        flow.start()
                    }
                    .help(fixHelp)
                }
            }
        }
        .labelStyle(.titleAndIcon)
        .fixedSize()
        // Quiet once it's up and unchanged; prominent when there's something to do.
        .publishPillStyle(prominent: !flow.isUpToDate, size: size)
    }

    private var fixHelp: String {
        let until = flow.fixableUntil.map { " until \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        return "You've changed it since publishing. Nobody has reacted or commented yet, so you can still fix it\(until)."
    }

    @ViewBuilder private var menuItems: some View {
        if flow.record != nil {
            Button("View on \(PublishSite.name)") { flow.view() }
            Button("Copy Link") { flow.copyLink() }
            Button("Add a P.S.…") { flow.startPostscript() }
            if flow.hasLockedChanges {
                Button("Its text is locked: your changes stay on your Mac") {}
                    .disabled(true)
            }
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
/// closed: only once the piece is published (Published · View, or Fix).
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
    @ViewBuilder func publishPillStyle(prominent: Bool, size: ControlSize) -> some View {
        if #available(macOS 26.0, *) {
            if prominent {
                self.buttonStyle(.glassProminent).controlSize(size)
            } else {
                self.buttonStyle(.glass).controlSize(size)
            }
        } else {
            self.menuStyle(.button).buttonStyle(.bordered).controlSize(size)
        }
    }
}
