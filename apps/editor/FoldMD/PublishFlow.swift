import AppKit
import SwiftUI

/// Publishing one document: what the Publish pill says, and the steps of
/// its sheet. Connecting (the first time), choosing an author name (the
/// first publish ever), then the pledge and Publish. Only the document's
/// text is ever sent: self-notes live in their own file and never are.
///
/// What you publish is a new post, or a P.S. under one of your posts (paste
/// its link). A new post can be fixed only in its fix window (15 minutes,
/// and until anyone reacts or comments); then its text is locked, so what
/// readers reacted to stays what's there. The site enforces it.
///
/// Fold MD remembers which post a file became only for that window, to
/// offer Fix. After it, the file is just a file again: the site is what
/// knows what you've published, and says so when you publish something
/// that looks like a post you already have.
@MainActor @Observable
final class PublishFlow {
    /// What the pill says.
    enum Pill: Equatable {
        case publish
        /// Up, in its fix window, and unchanged.
        case published(URL)
        /// Changed since, and still in its fix window.
        case fix(URL)
    }

    /// Where the sheet is. nil: no sheet.
    enum Step: Equatable {
        /// Talking to the site.
        case working(String)
        /// Showing the code, waiting for Allow on the site.
        case connect(SiteAPI.DeviceCode)
        /// The code ran out, or you didn't allow it.
        case notConnected(String)
        /// Your first publish: how you appear on the site.
        case author
        /// The pledge, and Publish (or Fix, or Add P.S.).
        case publish
        /// You tried to fix it, but its text is locked now.
        case locked
        /// The P.S. is up.
        case postscriptAdded
        /// Something went wrong before the sheet could do anything.
        case failed(String)
    }

    /// What publishing makes.
    enum Kind: String, CaseIterable {
        case post = "New post"
        case postscript = "P.S."
    }

    private(set) var fileURL: URL?
    /// Where this file's (or series') record of its post lives, while it
    /// has one. nil for an untitled document: its record stays in memory.
    private(set) var recordURL: URL?

    /// Publishing a whole series as one piece: which series, and how many
    /// parts it had when last put together. nil for a file.
    private(set) var seriesID: Series.ID?
    private(set) var parts: Int?
    var isSeries: Bool { seriesID != nil }
    /// The post this file (or series) became, only while it can be fixed.
    private(set) var record: PublishRecord?
    /// The post it was, once Fold MD has let go of it: for the Locked step's
    /// words and its Copy Link.
    private(set) var lastPost: (title: String, url: URL)?

    /// The document's text, as it is now.
    var text = "" {
        didSet {
            guard text != oldValue, record != nil else { return }
            if case .fix = pill { checkFixWindow() }
        }
    }
    /// Its pictures on this Mac as they are now (their sizes and times), so
    /// replacing or cropping one also offers Fix. Looked at every few
    /// seconds, and only while there's something to fix.
    private(set) var pictureStamp = ""
    /// The parts' files as they are now, for a series.
    @ObservationIgnored private var partsStamp = ""

    /// The text and its pictures, to tell whether either changed since it
    /// was published. Worked out when asked (only a post in its fix window
    /// asks), not on every keystroke.
    @ObservationIgnored private var printed: (text: String, stamp: String, hash: String)?
    private var fingerprint: String {
        if let printed, printed.text == text, printed.stamp == pictureStamp { return printed.hash }
        let hash = Self.fingerprint(text, pictureStamp)
        printed = (text, pictureStamp, hash)
        return hash
    }

    static func fingerprint(_ text: String, _ pictures: String) -> String {
        PublishRecord.hash(pictures.isEmpty ? text : text + "\u{0}" + pictures)
    }

    var step: Step?
    /// An error shown in the sheet under its fields.
    var error: String?
    var busy = false
    /// What a long publish is doing now (its pictures), for the button.
    private(set) var progress: String?

    /// Where the document's relative picture links start (a series' parts
    /// link theirs absolutely).
    private var pictureBase: URL? { isSeries ? nil : fileURL?.deletingLastPathComponent() }

    /// The pictures the piece shows, on this Mac or on the web (each once).
    var pictureCount: Int { PublishPictures.count(in: text, base: pictureBase) }

    // The author step.
    var accountName = ""
    var authorName = ""
    var handle = ""

    // The publish step.
    /// A new post or a P.S.: chosen in the sheet (a fix and a series are always a post).
    var kind = Kind.post
    var making: Kind { fixing != nil || isSeries ? .post : kind }
    var preview: SiteAPI.Preview?
    var pledged = false
    /// The pictures' own promise (copyright only), asked when there are any.
    var picturesPledged = false
    /// It looks like a post you've already published, and you said to
    /// publish it as a new one anyway.
    var duplicateConfirmed = false
    /// The post being fixed, as it stood when the sheet opened: if its
    /// window closes meanwhile, Fix still fixes it (and hears it's locked),
    /// never makes a new post.
    private(set) var fixing: PublishRecord?
    var isFix: Bool { fixing != nil }

    // A response: the link of the piece this new one responds to
    // (optional): one of yours makes it a follow-up, anyone else's a reply.
    // Then that piece, once the site has found it.
    var respondsToLink = "" {
        didSet { if respondsToLink != oldValue { findResponseTarget() } }
    }
    private(set) var respondsTo: SiteAPI.Piece?
    private(set) var respondsToProblem: String?
    private var finding: Task<Void, Never>?

    // A P.S.: the document's text, under the post this link is (yours).
    var postscriptLink = "" {
        didSet { if postscriptLink != oldValue { findPostscriptTarget() } }
    }
    private(set) var postscriptTarget: SiteAPI.Piece?
    private(set) var postscriptProblem: String?
    private var findingPostscript: Task<Void, Never>?
    /// The post the last P.S. went under, for the step that says it's up.
    private(set) var postscriptAddedTo: SiteAPI.Piece?
    /// A P.S. is short: anything longer belongs in a follow-up.
    static let postscriptMaxWords = 150
    var postscriptWords: Int { text.split(whereSeparator: \.isWhitespace).count }

    /// Who you publish as, once known.
    private(set) var author: SiteAPI.Author?
    private var polling: Task<Void, Never>?

    /// In the fix window, as far as Fold MD knows. Turns false on its own
    /// when the window's time runs out; the site can close it sooner (a
    /// reaction or a comment), which Fold MD hears when it checks.
    private(set) var fixable = false
    private var windowClosing: Task<Void, Never>?
    private var watching: Task<Void, Never>?
    private var lastCheck = Date.distantPast

    var pill: Pill {
        guard let record, fixable else { return .publish }
        return record.publishedHash == fingerprint ? .published(record.url) : .fix(record.url)
    }

    /// Published, and not changed since.
    var isUpToDate: Bool {
        if case .published = pill { true } else { false }
    }

    var isConnected: Bool { PublishToken.current != nil }

    /// When the fix window closes, if it's still open.
    var fixableUntil: Date? { fixable ? record?.fixableUntil : nil }

    // MARK: The file

    /// The document's file changed: find the post it became (if it can
    /// still be fixed), or carry what it published to where it is now: it
    /// was renamed or moved, or an untitled document was saved.
    func setFileURL(_ url: URL?) {
        guard url != fileURL else { return }
        let previous = fileURL
        fileURL = url
        if let url {
            if let record {
                if recordURL == nil { recordURL = PublishedFiles.newLocation() }
                keep(record, at: recordURL)
            } else {
                let found = PublishedFiles.find(for: url, site: PublishSite.base.absoluteString)
                recordURL = found?.location ?? PublishedFiles.newLocation()
                record = found?.record
            }
        } else if previous != nil {
            recordURL = nil
            record = nil
        }
        updateFixable()
    }

    /// Save the record (when it has somewhere to go), noting where its file
    /// is now (a file's, not a series').
    private func keep(_ record: PublishRecord, at location: URL?) {
        var record = record
        if !isSeries, let fileURL { PublishedFiles.stamp(&record, file: fileURL) }
        if let location { PublishedFiles.write(record, to: location) }
        self.record = record
    }

    /// Done with the post: its fix window closed, it was unpublished, or
    /// it's gone from the site. The file is just a file again.
    private func forget() {
        if let record { lastPost = (record.title, record.url) }
        if let recordURL { PublishedFiles.remove(at: recordURL) }
        // A file's next post gets a record of its own (a series' stays where it is).
        if !isSeries { recordURL = fileURL == nil ? nil : PublishedFiles.newLocation() }
        record = nil
    }

    // MARK: A series

    /// A flow for publishing a whole series, set up from the start.
    convenience init(series id: Series.ID) {
        self.init()
        seriesID = id
        recordURL = PublishRecord.fileURL(forSeries: id)
        record = PublishRecord.read(at: PublishRecord.fileURL(forSeries: id))
            .flatMap { $0.site == PublishSite.base.absoluteString ? $0 : nil }
        updateFixable()
    }

    /// Put the series' parts together again (as saved), to tell whether
    /// it's changed since it was published.
    func refreshSeries() async {
        guard let seriesID, let joined = try? await SeriesJoin.join(seriesID, saveOpen: false) else { return }
        text = joined.markdown
        parts = joined.parts
    }

    // MARK: The pill

    /// Publish (or Fix), or a P.S.
    func start(_ kind: Kind = .post) {
        self.kind = kind
        error = nil
        if let seriesID {
            // A series: put the parts together first, as they are now.
            step = .working("Putting the parts together…")
            Task {
                do {
                    let joined = try await SeriesJoin.join(seriesID)
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
        guard let token = PublishToken.current else { connect(); return }
        step = .working("Checking your account…")
        Task { await afterConnecting(token) }
    }

    func view() {
        if let url = record?.url ?? lastPost?.url { NSWorkspace.shared.open(url) }
    }

    /// The post's link, to paste where a new post asks what it responds to,
    /// or where a P.S. asks which post it goes under.
    func copyLink() {
        guard let url = record?.url ?? lastPost?.url else { return }
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
        guard let record, let token = PublishToken.current else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                try await SiteAPI.unpublish(token, postID: record.postID)
                forget()
                lastPost = nil
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
                        step = .notConnected("The code ran out before it was allowed.")
                        return
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

    // MARK: Links to posts

    /// The post id in a link like https://human-tokens.dev/p/AbC123xy/its-title.
    static func postID(in link: String) -> String? {
        let text = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let match = text.firstMatch(of: /\/p\/([0-9A-Za-z]{6,16})(?:[\/?#]|$)/) else { return nil }
        return String(match.1)
    }

    /// Look a pasted link up on the site: the piece, or what's wrong.
    private static func lookUp(_ link: String) async -> (piece: SiteAPI.Piece?, problem: String?)? {
        let link = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !link.isEmpty else { return nil }
        guard let id = postID(in: link) else { return (nil, "Paste the link of a post, like \(PublishSite.name)/p/…") }
        guard let token = PublishToken.current else { return nil }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return nil }
        do {
            return (try await SiteAPI.piece(token, postID: id), nil)
        } catch let failure as SiteAPI.Failure where failure.isGone {
            return (nil, "That post isn't on \(PublishSite.name).")
        } catch {
            return (nil, error.localizedDescription)
        }
    }

    /// The post a new one responds to: anyone's.
    private func findResponseTarget() {
        finding?.cancel()
        respondsTo = nil
        respondsToProblem = nil
        let link = respondsToLink
        finding = Task {
            let found = await Self.lookUp(link)
            guard !Task.isCancelled, let found else { return }
            respondsTo = found.piece
            respondsToProblem = found.problem
        }
    }

    /// The post a P.S. goes under: one of yours.
    private func findPostscriptTarget() {
        findingPostscript?.cancel()
        postscriptTarget = nil
        postscriptProblem = nil
        let link = postscriptLink
        findingPostscript = Task {
            let found = await Self.lookUp(link)
            guard !Task.isCancelled, let found else { return }
            if let piece = found.piece, !piece.yours {
                postscriptProblem = "That's \(piece.author.name)'s post. A P.S. goes under one of yours; to answer theirs, publish a new post that responds to it."
            } else {
                postscriptTarget = found.piece
                postscriptProblem = found.problem
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

    /// Open while its time lasts; once it's over, let the post go.
    private func updateFixable() {
        windowClosing?.cancel()
        guard let until = record?.fixableUntil, until > .now else {
            if record != nil { forget() }
            fixable = false
            watching?.cancel()
            watching = nil
            return
        }
        fixable = true
        windowClosing = Task { [weak self] in
            try? await Task.sleep(for: .seconds(until.timeIntervalSinceNow + 0.5))
            guard !Task.isCancelled else { return }
            self?.updateFixable()
        }
        watch()
    }

    /// While it can be fixed, look every couple of seconds at what the
    /// text can't show: its pictures, and a series' saved parts.
    private func watch() {
        guard watching == nil else { return }
        watching = Task { [weak self] in
            while !Task.isCancelled {
                guard await self?.look() == true else { return }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    private func look() async -> Bool {
        guard fixable else { watching = nil; return false }
        if let seriesID {
            let stamp = SeriesJoin.stamp(seriesID)
            if stamp != partsStamp {
                partsStamp = stamp
                await refreshSeries()
            }
        }
        let stamp = PublishPictures.stamp(in: text, base: pictureBase)
        if stamp != pictureStamp { pictureStamp = stamp }
        return fixable
    }

    /// Remember what the site says about the post now.
    private func apply(_ post: SiteAPI.Post) {
        guard var record, record.postID == post.id else { return }
        record.fixableUntil = post.fixableUntilDate
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
        forget()
        lastPost = nil
        updateFixable()
    }

    // MARK: Publishing

    private func showPublish(_ token: String) async {
        fixing = nil
        if kind == .post, let record {
            // Fixing: make sure it still can be.
            do {
                apply(try await SiteAPI.post(token, postID: record.postID))
                guard self.record != nil else { step = .locked; return }
                fixing = self.record
            } catch let failure as SiteAPI.Failure where failure.isGone {
                forgetGonePost()
            } catch {
                if step != nil { step = .failed(error.localizedDescription) }
                return
            }
        }
        pledged = false
        picturesPledged = false
        duplicateConfirmed = false
        preview = nil
        error = nil
        step = .publish
        do {
            preview = try await SiteAPI.preview(token, markdown: text)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Why a P.S. can't go as it is, or nil.
    var postscriptIssue: String? {
        let words = postscriptWords, max = Self.postscriptMaxWords
        if words == 0 { return "Write the P.S. in this document first." }
        if words > max { return "\(words) of \(max) words. For more, publish a new post that responds to it." }
        if pictureCount > 0 { return "A P.S. is words only. For pictures, publish a new post that responds to it." }
        return nil
    }

    var canPublish: Bool {
        guard pledged, !busy else { return false }
        switch making {
        case .postscript:
            return postscriptTarget?.yours == true && postscriptIssue == nil
        case .post:
            // A pasted link has to be found first (or cleared).
            let respondsToReady = isFix || respondsToLink.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || respondsTo != nil
            // A fix doesn't count as a new post, and isn't a duplicate.
            let underLimit = isFix || preview?.limitReached == nil
            let notDuplicate = isFix || preview?.duplicate == nil || duplicateConfirmed
            let picturesReady = picturesPledged || pictureCount == 0
            return picturesReady && preview?.title != nil && respondsToReady && underLimit && notDuplicate
        }
    }

    func publish() {
        guard canPublish, let token = PublishToken.current else { return }
        if making == .postscript { addPostscript(token); return }
        let markdown = text
        let base = pictureBase
        let fixing = self.fixing
        let sourceID = fixing?.sourceID ?? UUID().uuidString
        // Only a new post can respond to another.
        let respondsToID = fixing == nil ? respondsTo?.id : nil
        let parts = self.parts
        busy = true
        error = nil
        Task {
            defer { busy = false; progress = nil }
            do {
                // Pictures first: pictures from the web fetched, then all of
                // them made ready on this Mac, then the ones the site
                // doesn't have yet are sent. The post links them by hash.
                let web = try await PublishPictures.fetchWebPictures(in: markdown) { [weak self] in self?.progress = $0 }
                if pictureCount > 0 { progress = "Getting pictures ready…" }
                let ready = try await Task.detached(priority: .userInitiated) {
                    try PublishPictures.ready(markdown, base: base, web: web)
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
                let stamp = PublishPictures.stamp(in: markdown, base: base)
                pictureStamp = stamp
                let record = PublishRecord(site: PublishSite.base.absoluteString, sourceID: sourceID, postID: post.id,
                                           url: post.url, title: post.title,
                                           publishedHash: Self.fingerprint(markdown, stamp), publishedAt: Date(),
                                           fixableUntil: post.fixableUntilDate)
                keep(record, at: recordURL)
                self.fixing = nil
                lastPost = nil
                updateFixable()
                respondsToLink = ""
                step = nil
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                connect()
            } catch let failure as SiteAPI.Failure where failure.isLocked {
                if let fixing { lastPost = (fixing.title, fixing.url) }
                self.fixing = nil
                if record != nil { forget() }
                updateFixable()
                step = .locked
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    /// The document's text, as a P.S. under the post its link names.
    private func addPostscript(_ token: String) {
        guard let target = postscriptTarget else { return }
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                _ = try await SiteAPI.addPostscript(token, postID: target.id, body: body)
                postscriptAddedTo = target
                postscriptLink = ""
                pledged = false
                step = .postscriptAdded
            } catch SiteAPI.Failure.notConnected {
                PublishToken.forget()
                connect()
            } catch let failure as SiteAPI.Failure where failure.isGone {
                self.error = "That post isn't on \(PublishSite.name) any more."
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}

// MARK: - The pill

/// In the publishing surface's strip: Publish; once it's up, and for its
/// fix window, Published · View, or Fix when it has changed. Its menu has
/// View, Copy Link and Unpublish while Fold MD remembers the post, and a
/// P.S. under one of your posts.
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
                    .help("Publish this post on \(PublishSite.name)")
                case .published:
                    Menu {
                        menuItems
                    } label: {
                        Label("Published · View", systemImage: "checkmark.circle")
                    } primaryAction: {
                        flow.view()
                    }
                    .help(publishedHelp)
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

    private var publishedHelp: String {
        let until = flow.fixableUntil.map { " Until \($0.formatted(date: .omitted, time: .shortened)), you can still fix it." } ?? ""
        return "Open it on \(PublishSite.name).\(until) Hold for more."
    }

    private var fixHelp: String {
        let until = flow.fixableUntil.map { " until \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        return "You've changed it since publishing. Nobody has reacted or commented yet, so you can still fix it\(until)."
    }

    @ViewBuilder private var menuItems: some View {
        if flow.record != nil {
            Button("View on \(PublishSite.name)") { flow.view() }
            Button("Copy Link") { flow.copyLink() }
            Divider()
            Button("Unpublish…") { flow.confirmUnpublish() }
        } else {
            Button("Publish…") { flow.start() }
        }
        if !flow.isSeries {
            Button("Add as a P.S. to One of Your Posts…") { flow.start(.postscript) }
        }
        if flow.isConnected {
            Divider()
            Button("Disconnect Fold MD from \(PublishSite.name)") { flow.disconnect() }
        }
    }
}

/// The pill in the window's own toolbar, while the publishing surface is
/// closed: only while the post can be fixed (Published · View, or Fix).
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
