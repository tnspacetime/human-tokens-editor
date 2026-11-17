import AppKit
import SwiftUI

/// The publishing surface's own strip of the toolbar. The toolbar spans the
/// whole window, so without this its buttons would follow the window's right
/// edge out over the page. This reserves the toolbar's trailing part, exactly
/// as wide as the page, so the editor's buttons stay above the editor, and
/// puts the page's own controls there: Contents, and the Publish pill.
@MainActor
final class PageBar {
    let model = PageBarModel()
    private var accessory: NSTitlebarAccessoryViewController?
    private weak var window: NSWindow?

    /// How much of the window's width the page takes right now (0 = closed).
    /// Follows the page frame by frame while it slides.
    func setWidth(_ width: CGFloat, in window: NSWindow?) {
        guard let window else { return }
        if accessory == nil || self.window !== window { install(in: window) }
        guard let accessory else { return }
        let width = max(0, width.rounded())
        let height = max(28, window.frame.height - window.contentLayoutRect.maxY)
        if width < 1 {
            if !accessory.isHidden { accessory.isHidden = true }
            if model.showingContents { model.showingContents = false }
            return
        }
        accessory.view.setFrameSize(NSSize(width: width, height: height))
        if accessory.isHidden { accessory.isHidden = false }
    }

    private func install(in window: NSWindow) {
        if let accessory, let index = self.window?.titlebarAccessoryViewControllers.firstIndex(of: accessory) {
            self.window?.removeTitlebarAccessoryViewController(at: index)
        }
        let host = DraggableHostingView(rootView: PageBarContent(model: model))
        host.sizingOptions = []
        host.frame = NSRect(x: 0, y: 0, width: 0, height: 52)
        let controller = NSTitlebarAccessoryViewController()
        controller.view = host
        controller.layoutAttribute = .trailing
        controller.isHidden = true
        window.addTitlebarAccessoryViewController(controller)
        accessory = controller
        self.window = window
    }
}

/// Empty toolbar space still moves the window when dragged.
private final class DraggableHostingView<Content: View>: NSHostingView<Content> {
    override var mouseDownCanMoveWindow: Bool { true }
}

/// What the page's controls need from the window.
@MainActor @Observable
final class PageBarModel {
    var text = ""
    var currentTitle = ""
    var fileURL: URL?
    var seriesID: Series.ID?
    var showingContents = false
    /// Publishing this document (the pill, and the sheet behind it).
    let publish = PublishFlow()
    @ObservationIgnored var onOpenPart: (URL, Series.ID?) -> Void = { _, _ in }
    @ObservationIgnored var onHeading: (Int) -> Void = { _ in }
}

private struct PageBarContent: View {
    @Bindable var model: PageBarModel

    var body: some View {
        HStack(spacing: 0) {
            Button {
                model.showingContents.toggle()
            } label: {
                Label("Contents", systemImage: "list.bullet")
                    .labelStyle(.titleAndIcon)
            }
            .toolbarLikeButton()
            .help("This document's headings, and the other parts of its series")
            .popover(isPresented: $model.showingContents, arrowEdge: .bottom) {
                ContentsList(model: model)
            }
            Spacer(minLength: 12)
            PublishPill(flow: model.publish)
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private extension View {
    @ViewBuilder func toolbarLikeButton() -> some View {
        if #available(macOS 26.0, *) {
            self.buttonStyle(.glass).controlSize(.large)
        } else {
            self.buttonStyle(.bordered)
        }
    }
}

// MARK: - The contents

/// The series' parts in order, with the current part's headings under it; or,
/// outside a series, just the document's headings. Click to go there.
private struct ContentsList: View {
    let model: PageBarModel

    var body: some View {
        // As tall as it needs to be, scrolling only past the maximum.
        ViewThatFits(in: .vertical) {
            list
            ScrollView { list }
        }
        .frame(width: 320)
        .frame(maxHeight: 460)
    }

    private var list: some View {
        let library = SeriesLibrary.shared
        let headings = Outline.headings(in: model.text)
        let currentKey = model.fileURL.map(SeriesLibrary.key)
        return VStack(alignment: .leading, spacing: 1) {
            if let id = model.seriesID, let series = library.series(id) {
                Text(series.title)
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.bottom, 6)
                ForEach(Array(series.parts.enumerated()), id: \.element.id) { index, part in
                    let url = library.url(for: part)
                    let isCurrent = url.map(SeriesLibrary.key) == currentKey
                    if isCurrent {
                        ContentsRow(indent: 0, leading: "\(index + 1)", title: model.currentTitle, isCurrent: true) {
                            model.showingContents = false
                            model.onHeading(0)
                        }
                        // The part's own "# Title" is the row above.
                        ForEach(headings.filter { $0.level > 1 }) { heading in
                            // Under the part's title, one step in per level.
                            ContentsRow(indent: 26 + CGFloat(heading.level - 1) * 14, title: heading.title, small: true) {
                                go(to: heading)
                            }
                        }
                    } else if let url {
                        ContentsRow(indent: 0, leading: "\(index + 1)", title: library.title(of: url)) {
                            model.showingContents = false
                            model.onOpenPart(url, id)
                        }
                    } else {
                        ContentsRow(indent: 0, leading: "\(index + 1)",
                                    title: URL(fileURLWithPath: part.lastKnownPath).deletingPathExtension().lastPathComponent,
                                    note: "Can't be found", action: nil)
                    }
                }
            } else if headings.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No headings yet").font(.headline)
                    Text("Lines starting with # appear here.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .padding(8)
            } else {
                ForEach(headings) { heading in
                    ContentsRow(indent: CGFloat(heading.level - 1) * 14, title: heading.title,
                                isCurrent: false, emphasised: heading.level == 1) {
                        go(to: heading)
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func go(to heading: Outline.Heading) {
        model.showingContents = false
        model.onHeading(heading.line)
    }
}

private struct ContentsRow: View {
    var indent: CGFloat
    var leading: String?
    var title: String
    var isCurrent = false
    var emphasised = false
    /// A heading under a part: a size smaller than the parts.
    var small = false
    var note: String?
    var action: (() -> Void)?

    @State private var hovering = false

    var body: some View {
        Button {
            action?()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let leading {
                    Text(leading)
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(isCurrent ? Color.accentColor : .secondary)
                        .frame(width: 18, alignment: .trailing)
                }
                Text(title)
                    .font(isCurrent || emphasised ? .body.weight(.semibold) : small ? .callout : .body)
                    .foregroundStyle(action == nil || small ? .secondary : .primary)
                    .lineLimit(2)
                Spacer(minLength: 4)
                if let note {
                    Text(note).font(.caption).foregroundStyle(.orange)
                }
            }
            .padding(.leading, 8 + indent)
            .padding(.trailing, 8)
            .padding(.vertical, small ? 4 : 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isCurrent ? Color.accentColor.opacity(0.12)
                          : hovering && action != nil ? Color.primary.opacity(0.07) : .clear)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .onHover { hovering = $0 }
    }
}

// MARK: - Headings

enum Outline {
    struct Heading: Identifiable, Equatable {
        /// The source line (0-based), which is also its identity.
        var line: Int
        var level: Int
        var title: String
        var id: Int { line }
    }

    /// ATX headings ("# …" to "### …") outside fenced code blocks, with their
    /// source line numbers (lines split on "\n", like the editor counts them).
    static func headings(in text: String, maxLevel: Int = 3) -> [Heading] {
        var result: [Heading] = []
        var fence: Character?
        for (index, raw) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let indent = raw.prefix { $0 == " " }.count
            guard indent < 4 else { continue }
            let line = raw.dropFirst(indent)
            if let marker = line.first, marker == "`" || marker == "~", line.hasPrefix(String(repeating: marker, count: 3)) {
                if fence == nil { fence = marker } else if fence == marker { fence = nil }
                continue
            }
            guard fence == nil, line.first == "#" else { continue }
            let level = line.prefix { $0 == "#" }.count
            let rest = line.dropFirst(level)
            guard level <= maxLevel, rest.isEmpty || rest.first == " " || rest.first == "\t" else { continue }
            let title = plain(rest)
            if !title.isEmpty { result.append(Heading(line: index, level: level, title: title)) }
        }
        return result
    }

    /// A heading's text without markdown: no closing #s, links, or emphasis marks.
    private static func plain(_ text: Substring) -> String {
        var title = String(text).trimmingCharacters(in: .whitespacesAndNewlines)
        if let closing = title.range(of: #"(^|\s+)#+$"#, options: .regularExpression) {
            title.removeSubrange(closing)
        }
        title = title.replacingOccurrences(of: #"!?\[([^\]]*)\]\([^)]*\)"#, with: "$1", options: .regularExpression)
        title = title.replacingOccurrences(of: #"\*\*|__|`|(?<!\w)[*_]|[*_](?!\w)"#, with: "", options: .regularExpression)
        return title.trimmingCharacters(in: .whitespaces)
    }
}
