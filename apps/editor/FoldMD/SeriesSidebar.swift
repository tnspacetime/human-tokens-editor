import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The left slider: all your series, or one series' table of contents.
struct SeriesSidebar: View {
    @Binding var selection: Series.ID?
    /// The document in this window (nil while it's untitled).
    let currentFile: URL?
    /// Its title, live from the text (it may not be saved yet).
    let currentTitle: String
    let open: (URL, Series.ID) -> Void

    var body: some View {
        Group {
            if let id = selection, let series = SeriesLibrary.shared.series(id) {
                SeriesContents(series: series, currentFile: currentFile, currentTitle: currentTitle,
                               back: { selection = nil }, open: open)
                    .id(series.id)
            } else {
                SeriesList(currentFile: currentFile, select: { selection = $0 })
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(SidebarMaterial())
        .onAppear { SeriesLibrary.shared.refreshLocations() }
    }
}

// MARK: - All series

private struct SeriesList: View {
    let currentFile: URL?
    let select: (Series.ID) -> Void

    @State private var deleting: Series?
    private var library: SeriesLibrary { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Series").font(.headline)
                Spacer()
                Button(action: newSeries) { Image(systemName: "plus") }
                    .buttonStyle(.borderless)
                    .help(currentFile == nil ? "New Series" : "New Series with this document")
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 4)

            if library.all.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(library.recent) { series in
                        row(series)
                            .contentShape(Rectangle())
                            .onTapGesture { select(series.id) }
                            .contextMenu {
                                Button("Open") { select(series.id) }
                                Divider()
                                Button("Delete Series…", role: .destructive) { deleting = series }
                            }
                    }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
            }
        }
        .confirmationDialog("Delete “\(deleting?.title ?? "")”?", isPresented: Binding(
            get: { deleting != nil }, set: { if !$0 { deleting = nil } }
        )) {
            Button("Delete Series", role: .destructive) {
                if let deleting { library.delete(deleting.id) }
            }
        } message: {
            Text("Only the series is deleted. Your files stay where they are.")
        }
    }

    private func row(_ series: Series) -> some View {
        let missing = series.parts.filter { library.url(for: $0) == nil }.count
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Text(series.title).fontWeight(.medium).lineLimit(1).foregroundStyle(.primary)
                if missing > 0 {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .imageScale(.small)
                        .help(missing == 1 ? "1 file can't be found" : "\(missing) files can't be found")
                }
            }
            (Text(series.parts.count == 1 ? "1 part · " : "\(series.parts.count) parts · ")
                + Text(series.updated, format: .relative(presentation: .named)))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "books.vertical")
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(.secondary)
            Text("No series yet").font(.headline)
            Text("A series puts markdown files in order, to read and publish together. Your files stay where they are.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("New Series", action: newSeries)
                .padding(.top, 4)
        }
        .padding(24)
        .frame(maxWidth: .infinity)
    }

    private func newSeries() {
        select(library.create(with: currentFile.map { [$0] } ?? []))
    }
}

// MARK: - One series

private struct SeriesContents: View {
    let series: Series
    let currentFile: URL?
    let currentTitle: String
    let back: () -> Void
    let open: (URL, Series.ID) -> Void

    @State private var title = ""
    @State private var deleting = false
    /// Publishing the whole series as one piece (the pill at the foot).
    @State private var publish: PublishFlow
    @FocusState private var editingTitle: Bool
    private var library: SeriesLibrary { .shared }

    init(series: Series, currentFile: URL?, currentTitle: String, back: @escaping () -> Void,
         open: @escaping (URL, Series.ID) -> Void) {
        self.series = series
        self.currentFile = currentFile
        self.currentTitle = currentTitle
        self.back = back
        self.open = open
        // Set up for this series from the start (the view is remade per series).
        _publish = State(initialValue: PublishFlow(series: series.id))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: back) {
                Label("All Series", systemImage: "chevron.left").font(.callout)
            }
            .buttonStyle(.borderless)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.top, 10)

            TextField("Series title", text: $title)
                .textFieldStyle(.plain)
                .font(.title3.weight(.semibold))
                .focused($editingTitle)
                .onSubmit(commitTitle)
                .onChange(of: editingTitle) { _, editing in if !editing { commitTitle() } }
                .padding(.horizontal, 14)
                .padding(.top, 8)

            Text(summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.top, 2)
                .padding(.bottom, 4)

            if series.parts.isEmpty {
                dropZone
            } else {
                List {
                    ForEach(Array(series.parts.enumerated()), id: \.element.id) { index, part in
                        PartRow(number: index + 1, part: part, seriesID: series.id,
                                currentFile: currentFile, currentTitle: currentTitle, open: open)
                    }
                    .onMove { library.move(from: $0, to: $1, in: series.id) }
                    .onInsert(of: [.fileURL]) { index, providers in add(providers, at: index) }
                }
                .listStyle(.sidebar)
                .scrollContentBackground(.hidden)
            }

            Divider()
            HStack {
                Menu {
                    Button("Add This Document", action: addThisDocument)
                        .disabled(!canAddThisDocument)
                    Button("Add Files…", action: addFiles)
                } label: {
                    Label("Add", systemImage: "plus")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help(currentFile == nil ? "Save this document to add it to a series" : "Add files to this series")

                Spacer()

                if !series.parts.isEmpty {
                    PublishPill(flow: publish, size: .regular)
                        .help("Publish the whole series as one post, each part a chapter")
                }

                Menu {
                    Button("Delete Series…", role: .destructive) { deleting = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .onAppear {
            title = series.title
            if series.title == "Untitled Series" { editingTitle = true }
        }
        .task(id: series) {
            // Whether it has changed since it was published.
            await publish.refreshSeries()
        }
        #if DEBUG
        // Lets tests publish the series without clicking:
        // "md.fold.app.seriesPublish", logging where the flow stands.
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.seriesPublish"))) { _ in
            publish.start()
            Task {
                try? await Task.sleep(for: .seconds(2))
                let line = "series publish: [\(series.title)] step=\(String(describing: publish.step)) parts=\(publish.parts.map(String.init) ?? "-") pill=\(publish.pill)\n"
                let log = FileManager.default.temporaryDirectory.appending(path: "foldmd-probe.log")
                if let handle = try? FileHandle(forWritingTo: log) {
                    handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close()
                } else { try? Data(line.utf8).write(to: log) }
            }
        }
        #endif
        .sheet(isPresented: Binding(get: { publish.step != nil }, set: { if !$0 { publish.cancel() } })) {
            PublishSheet(flow: publish)
        }
        .confirmationDialog("Delete “\(series.title)”?", isPresented: $deleting) {
            Button("Delete Series", role: .destructive) {
                library.delete(series.id)
                back()
            }
        } message: {
            Text("Only the series is deleted. Your files stay where they are.")
        }
    }

    private var summary: String {
        let missing = series.parts.filter { library.url(for: $0) == nil }.count
        let parts = series.parts.count == 1 ? "1 part" : "\(series.parts.count) parts"
        return missing == 0 ? parts : "\(parts) · \(missing) can't be found"
    }

    private var canAddThisDocument: Bool {
        guard let currentFile else { return false }
        return !library.series(containing: currentFile).contains { $0.id == series.id }
    }

    private var dropZone: some View {
        VStack(spacing: 8) {
            Image(systemName: "doc.badge.plus")
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(.secondary)
            Text("Drop markdown files here, or use Add below.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
        .contentShape(Rectangle())
        .dropDestination(for: URL.self) { urls, _ in
            library.add(urls, to: series.id)
            return true
        }
    }

    private func commitTitle() {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            title = series.title
        } else if trimmed != series.title {
            library.rename(series.id, to: trimmed)
        }
    }

    private func addThisDocument() {
        if let currentFile { library.add([currentFile], to: series.id) }
    }

    private func addFiles() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.markdownText]
        panel.allowsMultipleSelection = true
        panel.prompt = "Add to Series"
        if panel.runModal() == .OK { library.add(panel.urls, to: series.id) }
    }

    /// Files dropped between parts: they load one by one, in any order,
    /// so they go in together once all have arrived, in the order dropped.
    private func add(_ providers: [NSItemProvider], at index: Int) {
        let id = series.id
        Task { @MainActor in
            var urls: [URL] = []
            for provider in providers {
                if let url = await Self.url(from: provider) { urls.append(url) }
            }
            SeriesLibrary.shared.add(urls, to: id, at: index)
        }
    }

    private static func url(from provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
        }
    }
}

// MARK: - A part

private struct PartRow: View {
    let number: Int
    let part: SeriesPart
    let seriesID: Series.ID
    let currentFile: URL?
    let currentTitle: String
    let open: (URL, Series.ID) -> Void

    private var library: SeriesLibrary { .shared }

    var body: some View {
        let url = library.url(for: part)
        let isCurrent = url != nil && currentFile.map(SeriesLibrary.key) == url.map(SeriesLibrary.key)
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(number)")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.tertiary)
                .frame(minWidth: 18, alignment: .trailing)
            VStack(alignment: .leading, spacing: 3) {
                if let url {
                    Text(isCurrent ? currentTitle : library.title(of: url))
                        .fontWeight(isCurrent ? .semibold : .regular)
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                } else {
                    missing
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 4)
        .background(isCurrent ? Color.accentColor.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { if let url, !isCurrent { open(url, seriesID) } }
        .help(url?.path ?? "")
        .contextMenu {
            if let url {
                Button("Show in Finder") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
            } else {
                Button("Locate…", action: locate)
            }
            Divider()
            Button("Remove from Series") { library.remove(part.id, from: seriesID) }
        }
    }

    /// A part whose file can't be found: what was there, and how to fix it.
    private var missing: some View {
        let path = part.lastKnownPath as NSString
        let folder = (path.deletingLastPathComponent as NSString).abbreviatingWithTildeInPath
        return VStack(alignment: .leading, spacing: 3) {
            Text(path.lastPathComponent)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            HStack(spacing: 4) {
                Image(systemName: "exclamationmark.triangle.fill")
                Text("Can't be found")
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(.orange)
            Text("Last seen in \(folder)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .truncationMode(.middle)
            HStack(spacing: 12) {
                Button("Locate…", action: locate)
                Button("Remove") { library.remove(part.id, from: seriesID) }
            }
            .buttonStyle(.link)
            .font(.caption)
        }
    }

    private func locate() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.markdownText]
        panel.message = "Find “\((part.lastKnownPath as NSString).lastPathComponent)”"
        panel.prompt = "Use This File"
        let folder = (part.lastKnownPath as NSString).deletingLastPathComponent
        if FileManager.default.fileExists(atPath: folder) { panel.directoryURL = URL(fileURLWithPath: folder) }
        if panel.runModal() == .OK, let url = panel.url {
            library.relocate(part.id, in: seriesID, to: url)
        }
    }
}

/// The standard translucent sidebar background.
private struct SidebarMaterial: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .followsWindowActiveState
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}
