import AppKit
import SwiftUI

/// The sheet behind the Publish pill, one step at a time (PublishFlow.Step).
struct PublishSheet: View {
    @Bindable var flow: PublishFlow

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch flow.step {
            case .save: save
            case .working(let message): working(message)
            case .connect(let code): connect(code)
            case .notConnected(let reason): notConnected(reason)
            case .author: author
            case .publish: publish
            case .locked: locked
            case .postscript: postscript
            case .postscriptAdded: postscriptAdded
            case .failed(let message): failed(message)
            case nil: EmptyView()
            }
        }
        .padding(24)
        .frame(width: 460, alignment: .leading)
        .animation(.default, value: flow.step)
    }

    // MARK: Steps

    private var save: some View {
        StepLayout(title: "Save it first",
                   message: "Fold MD remembers which piece each file becomes, so it needs a file. Save this document, then publish it.") {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button("Save…") { NSApp.sendAction(#selector(NSDocument.save(_:)), to: nil, from: nil) }
                .keyboardShortcut(.defaultAction)
        }
    }

    private func working(_ message: String) -> some View {
        StepLayout(title: nil, message: nil) {
            Button("Cancel", role: .cancel) { flow.cancel() }
        } content: {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(message).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 80)
        }
    }

    private func connect(_ code: SiteAPI.DeviceCode) -> some View {
        StepLayout(title: "Connect to Human Tokens",
                   message: "To publish as you, Fold MD needs your OK on \(PublishSite.name). Open it, sign in with Google or GitHub if you need to, and allow this code:") {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button("Open \(PublishSite.name)") { flow.openSite() }
                .keyboardShortcut(.defaultAction)
        } content: {
            VStack(spacing: 14) {
                Text(code.shownCode)
                    .font(.system(size: 34, weight: .semibold, design: .monospaced))
                    .tracking(4)
                    .textSelection(.enabled)
                    .padding(.vertical, 12)
                    .padding(.horizontal, 22)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.06)))
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Waiting for you to allow it…")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func notConnected(_ reason: String) -> some View {
        StepLayout(title: "Not connected", message: reason) {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button("Get a New Code") { flow.connect() }
                .keyboardShortcut(.defaultAction)
        }
    }

    private var author: some View {
        StepLayout(title: "How you'll appear",
                   message: "This is your first piece on \(PublishSite.name). Choose the name readers see on your pieces, and a short handle.") {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button("Continue") { flow.becomeAuthor() }
                .keyboardShortcut(.defaultAction)
                .disabled(flow.busy || flow.authorName.trimmingCharacters(in: .whitespaces).isEmpty || flow.handle.isEmpty)
        } content: {
            Form {
                TextField("Name", text: $flow.authorName, prompt: Text(flow.accountName))
                TextField("Handle", text: $flow.handle, prompt: Text("yourname"))
                    .textContentType(.username)
                    .autocorrectionDisabled()
            }
            .formStyle(.columns)
            .disabled(flow.busy)
            Text("A handle is 2 to 30 letters, numbers, - or _.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.leading, 62)
            ErrorLine(flow.error)
        }
    }

    private var publish: some View {
        let title = flow.isFix ? "Fix" : "Publish"
        let until = flow.fixableUntil.map { " until \($0.formatted(date: .omitted, time: .shortened))" } ?? ""
        let message = flow.isFix
            ? "Nobody has reacted or commented yet, so you can still fix it\(until). After that its text is locked."
            : flow.isSeries
            ? "All \(flow.parts ?? 0) parts, joined into one piece in the sidebar's order, each part a chapter. For 15 minutes after you publish, until someone reacts or comments, you can still fix it. Then its text is locked."
            : "This is how it starts in the feed. For 15 minutes after you publish, until someone reacts or comments, you can still fix it. Then its text is locked, so it stays as readers saw it."
        return StepLayout(title: title, message: message) {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button(flow.busy ? (flow.progress ?? (flow.isFix ? "Fixing…" : "Publishing…")) : title) { flow.publish() }
                .keyboardShortcut(.defaultAction)
                .disabled(!flow.canPublish)
        } content: {
            PreviewCard(preview: flow.preview, author: flow.author)
            if let preview = flow.preview, preview.title == nil {
                Text("Give it a title first: a first line like “# My title”.")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
            if !flow.isFix, let reason = flow.preview?.limitReached {
                Text(reason)
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let pictures = flow.pictureCount
            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: $flow.pledged) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("I wrote this myself. No AI wrote or rewrote any of it.")
                            .fontWeight(.medium)
                        if pictures > 0 {
                            Text(pictures == 1
                                 ? "The picture is mine or free to share, and wasn't made by AI."
                                 : "The \(pictures) pictures are mine or free to share, and none was made by AI.")
                                .fontWeight(.medium)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Link("Read the rules", destination: PublishSite.rules)
                            .font(.caption)
                    }
                }
            }
            .toggleStyle(.checkbox)
            .disabled(flow.busy)
            if !flow.isFix { respondsToField }
            ErrorLine(flow.error)
        }
    }

    /// A new piece can respond to another: paste its link. One of yours
    /// makes it a follow-up; anyone else's, a reply.
    private var respondsToField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Responds to a piece? (optional)")
                .font(.callout)
            TextField("Paste its link", text: $flow.respondsToLink)
                .textFieldStyle(.roundedBorder)
                .disabled(flow.busy)
            if let piece = flow.respondsTo {
                Label(piece.yours
                      ? "A follow-up to your “\(piece.title)”. That piece will point forward to this one."
                      : "A reply to “\(piece.title)” by \(piece.author.name). Their piece will list it under Replies.",
                      systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundStyle(.green)
            } else if let problem = flow.respondsToProblem {
                Text(problem)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
    }

    private var locked: some View {
        StepLayout(title: "Its text is locked",
                   message: "“\(flow.record?.title ?? "This piece")” has been up for more than 15 minutes, or someone has reacted or commented, so it stays as readers saw it. Your changes stay on your Mac.\n\nTo say more, add a P.S., or write a new piece and paste this one's link when you publish it, as the piece it responds to.") {
            Button("Copy Link") { flow.copyLink() }
            Button("OK") { flow.cancel() }
                .keyboardShortcut(.defaultAction)
        }
    }

    private var postscript: some View {
        let words = flow.postscriptWords, max = PublishFlow.postscriptMaxWords
        return StepLayout(title: "Add a P.S.",
                          message: "A short note at the end of “\(flow.record?.title ?? "your piece")”, dated today. It can't be changed or removed afterwards.") {
            Button("Cancel", role: .cancel) { flow.cancel() }
            Button(flow.busy ? "Adding…" : "Add P.S.") { flow.addPostscript() }
                .keyboardShortcut(.defaultAction)
                .disabled(!flow.canAddPostscript)
        } content: {
            TextEditor(text: $flow.postscript)
                .font(.body)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(height: 130)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
                .disabled(flow.busy)
            Text(words > max ? "\(words) of \(max) words. For more, publish a follow-up." : "\(words) of \(max) words")
                .font(.caption)
                .monospacedDigit()
                .foregroundStyle(words > max ? .red : .secondary)
            Toggle(isOn: $flow.postscriptPledged) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("I wrote this myself. No AI wrote or rewrote any of it.")
                        .fontWeight(.medium)
                    Link("Read the rules", destination: PublishSite.rules)
                        .font(.caption)
                }
            }
            .toggleStyle(.checkbox)
            .disabled(flow.busy)
            ErrorLine(flow.error)
        }
    }

    private var postscriptAdded: some View {
        StepLayout(title: "Your P.S. is up",
                   message: "It's at the end of “\(flow.record?.title ?? "your piece")”, with today's date.") {
            Button("View on \(PublishSite.name)") { flow.view(); flow.cancel() }
            Button("Done") { flow.cancel() }
                .keyboardShortcut(.defaultAction)
        }
    }

    private func failed(_ message: String) -> some View {
        StepLayout(title: "That didn't work", message: message) {
            Button("OK") { flow.cancel() }
                .keyboardShortcut(.defaultAction)
        }
    }
}

// MARK: - Pieces

/// A step: a title, a line or two, what the step shows, then its buttons
/// at the bottom right.
private struct StepLayout<Buttons: View, Content: View>: View {
    var title: String?
    var message: String?
    @ViewBuilder var buttons: Buttons
    @ViewBuilder var content: Content

    init(title: String?, message: String?, @ViewBuilder buttons: () -> Buttons,
         @ViewBuilder content: () -> Content = { EmptyView() }) {
        self.title = title
        self.message = message
        self.buttons = buttons()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if title != nil || message != nil {
                VStack(alignment: .leading, spacing: 6) {
                    if let title { Text(title).font(.title2.weight(.semibold)) }
                    if let message {
                        Text(message)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            content
            HStack {
                Spacer()
                buttons
            }
            .padding(.top, 4)
        }
    }
}

/// The piece as the feed will show it: its title and opening lines.
private struct PreviewCard: View {
    let preview: SiteAPI.Preview?
    let author: SiteAPI.Author?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let preview {
                if let author {
                    Text("\(author.name) · \(preview.minutes) min read")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(preview.title ?? "Untitled")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(preview.title == nil ? .secondary : .primary)
                ForEach(Array(preview.opening.prefix(2).enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            } else {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Reading it as the feed will…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, minHeight: 60)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.primary.opacity(0.05)))
    }
}

private struct ErrorLine: View {
    let message: String?
    init(_ message: String?) { self.message = message }

    var body: some View {
        if let message {
            Text(message)
                .font(.callout)
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
