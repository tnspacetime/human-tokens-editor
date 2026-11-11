import AppKit
import SwiftUI
import WebKit

enum DrawerMode: String, CaseIterable {
    /// Text you scroll past slides under the sheet and appears rendered.
    case under
    /// The sheet renders the paragraph the cursor is in.
    case focus
}

struct EditorWindow: View {
    @Binding var document: MarkdownDocument
    /// The document's file (nil while it's untitled).
    let fileURL: URL?

    @State private var sheet = PreviewBridge(role: .sheet)
    @State private var page = PreviewBridge(role: .page)
    @State private var window = WindowReference()
    /// The toolbar strip above the publishing surface (its Contents menu).
    @State private var pageBar = PageBar()

    /// Two panels slide out of the writing surface's sides, and the window
    /// grows to make room so the writing surface keeps its width: the series
    /// sidebar on the left, the publishing surface on the right.
    enum Panel: Hashable { case sidebar, page }
    @State private var sidebarOpen = false
    @State private var pageOpen = false
    @State private var sidebarSelection: Series.ID?
    /// The writing surface's width while a panel is out. It doesn't change.
    @State private var writingWidth: CGFloat = 0
    /// The page's width when fully out.
    @State private var pageWidth: CGFloat = 0
    @State private var sliding: Panel?
    /// How far the window moved sideways when each panel opened (to make
    /// room, or because it grew to the left); undone when it closes.
    @State private var originShift: [Panel: CGFloat] = [:]
    @State private var lastSeriesTouch = Date.distantPast
    static let sidebarWidth: CGFloat = 260

    /// How much rendered text has gone under the sheet (scroll-under mode).
    @State private var sheetFill: CGFloat = 0
    /// Set when you pull the sheet with its handle: it then stays exactly
    /// there. nil means automatic: the sheet is as tall as the text under it
    /// (up to the height you last pulled it to), so there's no empty band
    /// above your writing at the top of a document.
    @State private var pulledHeight: CGFloat?
    @State private var sheetDragging = false
    /// The sheet's height on screen, eased frame by frame.
    @State private var sheetMotion = HeightAnimator()
    @State private var contentHeight: CGFloat = 600

    /// How wide the publishing half slides out. Remembered when you resize it.
    @AppStorage("page.width") private var preferredPageWidth = 620.0
    @AppStorage("sheet.open") private var sheetOpen = true
    @AppStorage("sheet.height") private var sheetHeight = 220.0
    @AppStorage("sheet.mode") private var mode: DrawerMode = .under
    @AppStorage(AppearanceMode.key) private var appearance: AppearanceMode = .system
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        testHooks(window: content)
    }

    private var content: some View {
        GeometryReader { geometry in
            let total = geometry.size.width
            let writing = (sidebarOpen || pageOpen) ? min(writingWidth, total) : total
            let spare = max(0, total - writing)
            // While a panel slides, it gets whatever the growing window has
            // revealed so far; otherwise the sidebar is its fixed width and
            // the page takes the rest (so resizing the window resizes it).
            let sidebarShown: CGFloat = !sidebarOpen ? 0
                : sliding == .sidebar ? max(0, spare - (pageOpen ? pageWidth + 1 : 0) - 1)
                : min(Self.sidebarWidth, max(0, spare - 1))
            let pageShown: CGFloat = pageOpen ? max(0, spare - (sidebarOpen ? sidebarShown + 1 : 0) - 1) : 0
            HStack(spacing: 0) {
                // Pinned to the window's left edge, so it slides out from
                // behind the writing surface as the window grows leftwards.
                if sidebarOpen {
                    SeriesSidebar(selection: $sidebarSelection, currentFile: fileURL,
                                  currentTitle: currentTitle, open: openPart)
                        .frame(width: Self.sidebarWidth)
                        .frame(width: sidebarShown, alignment: .leading)
                        .clipped()
                    hinge
                }

                editorColumn(height: geometry.size.height)
                    .frame(width: writing)

                if pageOpen { hinge }
                // Pinned to the window's right edge, so as the window grows
                // the page slides out from behind the hinge (and back in).
                // Always present so it's loaded before it's needed.
                PageSurface(bridge: page, contentWidth: pageOpen ? pageWidth : 0)
                    .background(Color(nsColor: Theme.page))
                    .frame(width: pageShown)
            }
            // The toolbar above the page (and its hinge) belongs to the page.
            .onChange(of: pageOpen ? pageShown + 1 : 0, initial: true) { _, width in
                pageBar.setWidth(width, in: window.window)
            }
            .onChange(of: geometry.size.height, initial: true) { _, height in contentHeight = height }
        }
        .onAppear {
            let fill = $sheetFill
            sheet.onFill = { height in
                if abs(fill.wrappedValue - height) >= 1 { fill.wrappedValue = height }
            }
            page.onOpenPart = { url in openPart(url, seriesNavigation?.seriesID) }
            pageBar.model.onOpenPart = { url, seriesID in openPart(url, seriesID) }
            pageBar.model.onHeading = { [page] line in page.onJump?(line) }
            // Opened from a series (sidebar or page link): show that series.
            DispatchQueue.main.async { handleReveal() }
        }
        .onChange(of: SeriesLibrary.shared.reveal?.token) { _, _ in handleReveal() }
        .onChange(of: seriesNavigation, initial: true) { _, navigation in
            page.setSeries(navigation)
            pageBar.model.seriesID = navigation?.seriesID
        }
        .onChange(of: fileURL, initial: true) { _, url in
            pageBar.model.fileURL = url
            sheet.setDocumentURL(url)
            page.setDocumentURL(url)
        }
        .onChange(of: currentTitle, initial: true) { _, title in pageBar.model.currentTitle = title }
        .frame(minWidth: 520, minHeight: 360)
        .background(WindowReader(reference: window, fileURL: fileURL))
        .toolbar { toolbar }
        .onChange(of: document.text, initial: true) { _, text in
            sheet.setText(text)
            page.setText(text)
            pageBar.model.text = text
            // Editing a part moves its series to the top of the list.
            if let fileURL, Date().timeIntervalSince(lastSeriesTouch) > 30 {
                lastSeriesTouch = Date()
                for series in SeriesLibrary.shared.series(containing: fileURL) { SeriesLibrary.shared.touch(series.id) }
            }
        }
        .onChange(of: mode, initial: true) { _, mode in sheet.setMode(mode) }
        .onChange(of: pageAnchor, initial: true) { _, y in page.setAnchor(y) }
        .onChange(of: sheetOpen, initial: true) { _, open in sheet.isActive = open }
        .onChange(of: sheetMotion.value) { old, new in
            // Once you've pulled the sheet, it covers the text rather than
            // pushing it: the text stays still and the edge slides over it.
            // (Automatic mode grows with what's already under it, so it
            // mustn't do this, or it would keep covering more.)
            if pulledHeight != nil || sheetDragging { sheet.shiftEditor?(new - old) }
        }
        .onChange(of: sheetTarget, initial: true) { old, new in
            // Follow a finger or a scroll directly; glide for jumps (a
            // paragraph going under, letting go of the handle, ⌘\).
            let jump = abs(new - old) > 24
            sheetMotion.move(to: new, animated: !sheetDragging && jump && old != new)
        }
        .onChange(of: pageOpen, initial: true) { _, open in page.isActive = open }
        .onChange(of: appearance, initial: true) { _, appearance in appearance.apply() }
    }

    /// Debug builds: notifications that let tests drive the window (see
    /// each hook). Release builds: nothing.
    private func testHooks(window view: some View) -> some View {
        #if DEBUG
        pageBarHooks(view)
        // Lets tests toggle the publishing surface without keystrokes:
        // a distributed notification named "md.fold.app.togglePage".
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.togglePage"))) { _ in
            toggle(.page)
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.toggleSidebar"))) { _ in
            toggle(.sidebar)
        }
        // A temporary series for tests, from the .md files in the folder given
        // as the notification's object: create it and open its first part the
        // way the sidebar does ("…seriesDemo"); remove it and close its
        // windows ("…seriesDemoEnd"). Only the first window acts on these.
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.seriesDemo"))) { note in
            seriesDemo(folder: note.object as? String)
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.seriesOpen"))) { note in
            // Opens part N (the object, 1-based) of the series shown in the sidebar.
            guard let id = sidebarSelection, let series = SeriesLibrary.shared.series(id),
                  let n = (note.object as? String).flatMap(Int.init), series.parts.indices.contains(n - 1),
                  let url = SeriesLibrary.shared.url(for: series.parts[n - 1]) else { return }
            openPart(url, id)
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.seriesDemoEnd"))) { note in
            seriesDemoEnd(folder: note.object as? String)
        }
        // Sheet tests: drag the handle down 300pt from where it is and let
        // go ("md.fold.app.pull"), push it all the way up ("…push"), and
        // toggle it like ⌘\ ("…toggleSheet").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.pull"))) { _ in
            let start = sheetMotion.value
            Task { @MainActor in
                for step in 1...10 {
                    dragSheet(to: min(start + CGFloat(step) * 30, maxSheetHeight))
                    try? await Task.sleep(for: .milliseconds(16))
                }
                releaseSheet(at: min(start + 300, maxSheetHeight))
            }
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.push"))) { _ in
            let start = sheetMotion.value
            Task { @MainActor in
                for step in 1...10 {
                    dragSheet(to: max(0, start - start * CGFloat(step) / 10))
                    try? await Task.sleep(for: .milliseconds(16))
                }
                releaseSheet(at: 0)
            }
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.toggleSheet"))) { _ in
            sheetOpen.toggle()
        }
        // Records the sheet's height every 16ms for a second ("…trace").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.trace"))) { _ in
            Task { @MainActor in
                var samples: [String] = []
                for _ in 0..<60 {
                    let pulled = pulledHeight.map { String(Int($0)) } ?? "auto"
                    samples.append("\(Int(sheetMotion.value.rounded()))→\(Int(sheetTarget))[\(pulled)\(sheetDragging ? " drag" : "")] s\(editorScroll())")
                    try? await Task.sleep(for: .milliseconds(16))
                }
                var compact: [String] = []
                for sample in samples where compact.last != sample { compact.append(sample) }
                let line = "trace:\n  " + compact.joined(separator: "\n  ") + "\n"
                let url = FileManager.default.temporaryDirectory.appending(path: "foldmd-probe.log")
                if let handle = try? FileHandle(forWritingTo: url) {
                    handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close()
                } else { try? Data(line.utf8).write(to: url) }
            }
        }
        // Scrolls the editor down 400pt ("md.fold.app.scroll"), or with the
        // object "end" as far as it goes, then logs how much of the rendered
        // document is under the sheet.
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.scroll"))) { note in
            @MainActor func scrollViews(in view: NSView) -> [NSScrollView] {
                view.subviews.flatMap { ($0 as? NSScrollView).map { [$0] } ?? scrollViews(in: $0) }
            }
            guard let content = window.window?.contentView,
                  let scroll = scrollViews(in: content).first(where: { $0.documentView is FoldTextView }) else { return }
            let clip = scroll.contentView
            let y = note.object as? String == "end" ? (scroll.documentView?.frame.height ?? 0) : clip.bounds.minY + 400
            clip.scroll(to: clip.constrainBoundsRect(NSRect(origin: NSPoint(x: 0, y: y), size: clip.bounds.size)).origin)
            scroll.reflectScrolledClipView(clip)
            if note.object as? String == "end" { logEnd(scroll: scroll) }
        }
        // Logs which view would receive a click/scroll in the middle of the
        // writing surface ("md.fold.app.probe").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.probe"))) { _ in
            writeProbe()
        }
        #else
        view
        #endif
    }

    #if DEBUG
    /// More test hooks (split off so the compiler can type-check each chain).
    private func pageBarHooks(_ view: some View) -> some View {
        imageHooks(view)
        // Opens or closes the Contents popover ("md.fold.app.contents"), or
        // goes to the heading on the line given as the object ("…heading").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.contents"))) { _ in
            pageBar.model.showingContents.toggle()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { logContents() }
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.heading"))) { note in
            guard let line = (note.object as? String).flatMap(Int.init) else { return }
            pageBar.model.onHeading(line)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { writeProbe() }
        }
        // Logs where the toolbar's items sit, against the writing surface
        // ("md.fold.app.toolbarProbe").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.toolbarProbe"))) { _ in
            toolbarProbe()
        }
    }
    #endif

    /// Where the editor's top edge sits in the window: below the sheet and
    /// its handle. (The editor adds its own top padding when scrolled to 0.)
    private var pageAnchor: Double {
        sheetOpen ? sheetMotion.value + 12 : 0
    }

    private var maxSheetHeight: CGFloat { max(80, contentHeight - 60) }

    /// Where the sheet should be. Your pull wins; otherwise it's automatic.
    private var sheetTarget: CGFloat {
        guard sheetOpen else { return 0 }
        if let pulledHeight { return min(pulledHeight, maxSheetHeight) }
        let limit = min(max(sheetHeight, 60), maxSheetHeight)
        guard mode == .under else { return limit }
        return sheetFill < 24 ? 0 : min(limit, sheetFill + 10)
    }

    // MARK: Sliding panels

    private static let slideDuration = 0.36
    private static let minPageWidth: CGFloat = 480

    private func toggle(_ panel: Panel) {
        guard sliding == nil else { return }
        let isOpen = panel == .sidebar ? sidebarOpen : pageOpen
        guard let window = window.window, !window.styleMask.contains(.fullScreen) else {
            // Full screen: the window can't grow, so the panel takes room
            // from the writing surface instead.
            let width = window.window?.frame.width ?? 1000
            if panel == .page { pageWidth = width / 2 }
            setOpen(panel, !isOpen)
            writingWidth = width - (sidebarOpen ? Self.sidebarWidth + 1 : 0) - (pageOpen ? pageWidth + 1 : 0)
            return
        }

        var frame = window.frame
        if !isOpen {
            let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? frame
            if !sidebarOpen && !pageOpen { writingWidth = frame.width }
            if panel == .page { pageWidth = min(max(preferredPageWidth, Self.minPageWidth), 1400) }
            if panel == .sidebar, sidebarSelection == nil, let fileURL {
                // A part of a series: open straight to its table of contents.
                sidebarSelection = SeriesLibrary.shared.series(containing: fileURL).first?.id
            }
            let room = (panel == .sidebar ? Self.sidebarWidth : pageWidth) + 1
            var target = frame.width + room
            if target > screen.width {
                // Not enough screen: the page gives way first, then the writing surface.
                if panel == .page { pageWidth = max(Self.minPageWidth, pageWidth - (target - screen.width)) }
                target = screen.width
                let sidebar = (sidebarOpen || panel == .sidebar) ? Self.sidebarWidth + 1 : 0
                let page = (pageOpen || panel == .page) ? pageWidth + 1 : 0
                writingWidth = max(360, target - sidebar - page)
            }
            let oldX = frame.origin.x
            if panel == .sidebar { frame.origin.x -= target - frame.width } // grow to the left
            frame.size.width = target
            frame.origin.x = min(max(frame.origin.x, screen.minX), screen.maxX - frame.width)
            originShift[panel] = frame.origin.x - oldX
            setOpen(panel, true)
            slide(window, panel, to: frame) {}
        } else {
            let spare = frame.width - min(writingWidth, frame.width)
            let shown: CGFloat
            if panel == .page {
                shown = max(0, spare - (sidebarOpen ? Self.sidebarWidth + 1 : 0) - 1)
                // Remember the page width you ended up with (you may have resized).
                if shown >= Self.minPageWidth { preferredPageWidth = shown }
            } else {
                shown = Self.sidebarWidth
            }
            frame.size.width -= shown + 1
            frame.origin.x -= originShift[panel] ?? 0
            originShift[panel] = nil
            slide(window, panel, to: frame) { setOpen(panel, false) }
        }
    }

    private func setOpen(_ panel: Panel, _ open: Bool) {
        if panel == .sidebar { sidebarOpen = open } else { pageOpen = open }
    }

    private func slide(_ window: NSWindow, _ panel: Panel, to frame: NSRect, completion: @escaping @MainActor () -> Void) {
        sliding = panel
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.slideDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(frame, display: true)
        } completionHandler: {
            Task { @MainActor in
                completion()
                sliding = nil
            }
        }
    }

    // MARK: Series

    /// The document's title: its first "# Heading", or its file name.
    private var currentTitle: String {
        SeriesLibrary.firstHeading(in: document.text)
            ?? fileURL?.deletingPathExtension().lastPathComponent
            ?? "Untitled"
    }

    /// Where this document sits in a series, for the publishing surface.
    private var seriesNavigation: SeriesNavigation? {
        fileURL.flatMap { SeriesLibrary.shared.navigation(for: $0, currentTitle: currentTitle) }
    }

    /// Opens a part (from the sidebar or the page's previous/next links) in
    /// place of this one: the part takes over this window's position, size
    /// and panels, and this window closes (macOS saves its document first).
    /// An untitled document with text in it is left open instead, so nothing
    /// unsaved can be lost.
    private func openPart(_ url: URL, _ seriesID: Series.ID?) {
        let key = SeriesLibrary.key(url)
        let canClose = fileURL != nil || document.text.isEmpty
        if canClose, let current = window.window {
            WindowHandoff.pending[key] = WindowHandoff(
                frame: current.frame, sidebarOpen: sidebarOpen, pageOpen: pageOpen,
                writingWidth: writingWidth, pageWidth: pageWidth, originShift: originShift, from: current)
        }
        if let seriesID { SeriesLibrary.shared.requestReveal(of: seriesID, at: url) }
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
    }

    private func handleReveal() {
        guard let request = SeriesLibrary.shared.reveal, let fileURL,
              SeriesLibrary.key(fileURL) == request.path else { return }
        guard let current = window.window else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { handleReveal() }
            return
        }
        // A window that has already closed (macOS may keep it around for a
        // while) must not answer for its old document.
        guard NSDocumentController.shared.document(for: current) != nil else { return }
        SeriesLibrary.shared.consumeReveal()
        sidebarSelection = request.seriesID
        if let handoff = WindowHandoff.pending.removeValue(forKey: request.path) {
            take(handoff, in: current)
        } else if !sidebarOpen {
            toggle(.sidebar)
        }
    }

    /// Steps into the previous part's place: same frame, same panels, then
    /// closes its window. (The window was kept invisible until now.)
    private func take(_ handoff: WindowHandoff, in current: NSWindow) {
        writingWidth = handoff.writingWidth
        pageWidth = handoff.pageWidth
        originShift = handoff.originShift
        sidebarOpen = handoff.sidebarOpen
        pageOpen = handoff.pageOpen
        current.setFrame(handoff.frame, display: true)
        // Swap only once the sheet (and page, if out) have painted, so the
        // part appears complete in one step rather than flashing in.
        whenPreviewsPainted {
            current.alphaValue = 1
            current.makeKeyAndOrderFront(nil)
            if let previous = handoff.from, previous !== current {
                previous.performClose(nil)
            }
        }
    }

    /// Runs `body` once the visible previews have painted, or after half a
    /// second at most (so a slow render never blocks the switch).
    private func whenPreviewsPainted(attempt: Int = 0, _ body: @escaping @MainActor () -> Void) {
        let sheetReady = !sheetOpen || sheetMotion.value < 1 || sheet.hasPainted
        let pageReady = !pageOpen || page.hasPainted
        if (sheetReady && pageReady) || attempt >= 30 {
            #if DEBUG
            testLog("switch: shown after \(attempt * 16)ms (sheet painted: \(sheet.hasPainted), page painted: \(page.hasPainted))")
            #endif
            body()
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.016) {
                whenPreviewsPainted(attempt: attempt + 1, body)
            }
        }
    }

    #if DEBUG
    /// Appends a line to the test log.
    private func testLog(_ text: String) {
        let url = FileManager.default.temporaryDirectory.appending(path: "foldmd-probe.log")
        let line = Data((text + "\n").utf8)
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile(); handle.write(line); try? handle.close()
        } else { try? line.write(to: url) }
    }

    /// Tests send notifications to every window; some should act only once.
    private var isFirstWindow: Bool {
        NSDocumentController.shared.documents.first?.windowControllers.first?.window === window.window
    }

    private func seriesDemo(folder: String?) {
        guard isFirstWindow, let folder else { return }
        let urls = ((try? FileManager.default.contentsOfDirectory(at: URL(fileURLWithPath: folder), includingPropertiesForKeys: nil)) ?? [])
            .filter(SeriesLibrary.isMarkdown)
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
        let id = SeriesLibrary.shared.create(title: "Test Series (debug)", with: urls)
        if let first = urls.first { openPart(first, id) }
    }

    private func seriesDemoEnd(folder: String?) {
        guard let folder else { return }
        // Each window showing a test part closes itself.
        if let fileURL, fileURL.path.hasPrefix(folder) { window.window?.performClose(nil) }
        guard isFirstWindow else { return }
        for series in SeriesLibrary.shared.all where series.title == "Test Series (debug)" {
            SeriesLibrary.shared.delete(series.id)
        }
    }
    #endif

    private var hinge: some View {
        Rectangle().fill(Color(nsColor: .separatorColor)).frame(width: 1)
    }

    // MARK: Layout

    private func editorColumn(height: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Kept alive while hidden so reopening is instant.
            PreviewView(bridge: sheet)
                .background(Color(nsColor: Theme.sheet))
                .frame(height: sheetMotion.value)
                .clipped()
            if sheetOpen {
                SheetHandle(currentHeight: sheetMotion.value, range: 0...maxSheetHeight,
                            onDrag: dragSheet, onEnd: releaseSheet)
                    .zIndex(1)
            }
            SourceEditor(text: $document.text, fileURL: fileURL, sheet: sheet, page: page)
        }
    }

    #if DEBUG
    /// The editor's scroll offset, for tests.
    private func editorScroll() -> Int {
        @MainActor func find(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView, scroll.documentView is FoldTextView { return scroll }
            return view.subviews.lazy.compactMap(find).first
        }
        guard let content = window.window?.contentView, let scroll = find(content) else { return -1 }
        return Int(scroll.contentView.bounds.minY)
    }
    #endif

    #if DEBUG
    /// Logs which view would receive a click in the writing surface, and the
    /// state of the panels and sheet, for tests.
    /// The editor's text view and visible area, and what a click hits at a
    /// few heights (window coordinates, from the bottom).
    private func editorGeometry(in content: NSView, x: CGFloat) -> String {
        @MainActor func find(_ view: NSView) -> NSScrollView? {
            if let scroll = view as? NSScrollView, scroll.documentView is FoldTextView { return scroll }
            return view.subviews.lazy.compactMap(find).first
        }
        guard let scroll = find(content), let text = scroll.documentView else { return "" }
        let inWindow = scroll.convert(scroll.bounds, to: nil)
        let hits = [10, 20, 60, 200].map { y -> String in
            let hit = content.hitTest(NSPoint(x: x, y: CGFloat(y))).map { String(describing: type(of: $0)) } ?? "nil"
            return "\(y):\(hit)"
        }
        return "scrollView=\(Int(inWindow.minY))-\(Int(inWindow.maxY)) textH=\(Int(text.frame.height)) clip=\(Int(scroll.contentView.bounds.minY))-\(Int(scroll.contentView.bounds.maxY)) hits=\(hits)"
    }

    /// Images: log what each preview shows ("md.fold.app.images"); bring in
    /// the image file given as the object at the cursor, the way a drop does
    /// ("…insertImage"); paste ("…paste").
    private func imageHooks(_ view: some View) -> some View {
        view
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.images"))) { _ in
            logImages()
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.insertImage"))) { note in
            guard let path = note.object as? String, let text = foldTextView() else { return }
            text.insertImages(fromFiles: [URL(fileURLWithPath: path)], at: text.selectedRange())
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { logImages() }
        }
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.paste"))) { _ in
            foldTextView()?.paste(nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { logImages() }
        }
    }

    private func foldTextView() -> FoldTextView? {
        @MainActor func find(_ view: NSView) -> FoldTextView? {
            if let text = view as? FoldTextView { return text }
            return view.subviews.lazy.compactMap(find).first
        }
        return window.window?.contentView.flatMap(find)
    }

    private func logImages() {
        guard let content = window.window?.contentView else { return }
        @MainActor func webViews(in view: NSView) -> [WKWebView] {
            view.subviews.flatMap { ($0 as? WKWebView).map { [$0] } ?? webViews(in: $0) }
        }
        let script = """
        JSON.stringify({
          images: [...document.querySelectorAll('#content img')].map(i => (i.dataset.src || i.src) + (i.complete && i.naturalWidth > 0 ? ' ok ' + i.naturalWidth + 'px' : ' NOT LOADED')),
          missing: [...document.querySelectorAll('.img-missing')].map(m => m.textContent)
        })
        """
        let tail = String(document.text.suffix(160)).replacingOccurrences(of: "\n", with: "⏎")
        testLog("text tail: \(tail)")
        for web in webViews(in: content) {
            let role = web.superview is PageSurface.ContainerView ? "page" : "sheet"
            web.evaluateJavaScript(script) { value, error in
                testLog("images[\(role)]: \(value ?? error.map { "\($0)" } ?? "?")")
            }
        }
    }

    private func logContents() {
        let headings: [String] = Outline.headings(in: document.text).map { heading in
            "\(heading.level):\(heading.line):\(heading.title)"
        }
        testLog("contents: showing=\(pageBar.model.showingContents) series=\(pageBar.model.seriesID != nil) headings=\(headings)")
    }

    private func toolbarProbe() {
        guard let nsWindow = window.window, let frameView = nsWindow.contentView?.superview else { return }
        let left: CGFloat = sidebarOpen ? Self.sidebarWidth + 1 : 0
        let writing = (sidebarOpen || pageOpen) ? min(writingWidth, nsWindow.frame.width) : nsWindow.frame.width
        var items: [String] = []
        @MainActor func walk(_ view: NSView, depth: Int) {
            let name = String(describing: type(of: view))
            if name.contains("ItemView") || name.contains("Accessory") || view is NSSegmentedControl {
                let r = view.convert(view.bounds, to: nil)
                if r.width > 0, !view.isHiddenOrHasHiddenAncestor {
                    items.append("\(name.prefix(32))@\(Int(r.minX))-\(Int(r.maxX))")
                }
            }
            if depth < 14 { view.subviews.forEach { walk($0, depth: depth + 1) } }
        }
        walk(frameView, depth: 0)
        testLog("toolbar: window=\(Int(nsWindow.frame.width)) writing=\(Int(left))-\(Int(left + writing)) pageOpen=\(pageOpen) items=\(items)")
    }

    /// After scrolling to the end: the sheet's fill should equal the height
    /// of the whole rendered document (everything is under the sheet).
    private func logEnd(scroll: NSScrollView) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            guard let content = window.window?.contentView else { return }
            @MainActor func webViews(in view: NSView) -> [WKWebView] {
                view.subviews.flatMap { ($0 as? WKWebView).map { [$0] } ?? webViews(in: $0) }
            }
            let sheetView = webViews(in: content).first { !($0.superview is PageSurface.ContainerView) }
            let visibleText = Int(scroll.documentView!.frame.height - scroll.contentView.bounds.maxY)
            sheetView?.evaluateJavaScript("document.getElementById('content').offsetHeight") { value, _ in
                let line = "end: [\(fileURL?.lastPathComponent ?? "untitled")] mode=\(mode.rawValue) fill=\(Int(sheetFill)) rendered=\(value ?? "?") belowView=\(visibleText)\n"
                let url = FileManager.default.temporaryDirectory.appending(path: "foldmd-probe.log")
                if let handle = try? FileHandle(forWritingTo: url) {
                    handle.seekToEndOfFile(); handle.write(Data(line.utf8)); try? handle.close()
                } else { try? Data(line.utf8).write(to: url) }
            }
        }
    }

    private func writeProbe() {
        guard let content = window.window?.contentView else { return }
        let left: CGFloat = sidebarOpen ? Self.sidebarWidth + 1 : 0
        let writing: CGFloat = (sidebarOpen || pageOpen) ? min(writingWidth, content.bounds.width) : content.bounds.width
        let x: CGFloat = left + writing * 0.5
        // hitTest takes the superview's (window) coordinates, origin at
        // the bottom: 15pt up is inside the editor, below the sheet.
        let hit = content.hitTest(NSPoint(x: x, y: 15))
        let chain = sequence(first: hit, next: { $0?.superview }).prefix(3)
            .map { $0.map { String(describing: type(of: $0)) } ?? "nil" }
            .joined(separator: " < ")
        @MainActor func webViews(in view: NSView) -> [WKWebView] {
            view.subviews.flatMap { ($0 as? WKWebView).map { [$0] } ?? webViews(in: $0) }
        }
        let pages = webViews(in: content).filter { $0.frame.height > 0 && $0.superview is PageSurface.ContainerView }
            .map { "page w=\(Int($0.frame.width)) zoom=\(String(format: "%.2f", $0.pageZoom))" }
        let sheetView = webViews(in: content).first { !($0.superview is PageSurface.ContainerView) }
        let focus = window.window?.firstResponder.map { String(describing: type(of: $0)) } ?? "nil"
        let files: [String] = NSDocumentController.shared.documents.map { $0.fileURL?.lastPathComponent ?? "untitled" }
        let sheetHeight: Int = Int(sheetView?.frame.height ?? -1)
        var parts: [String] = []
        parts.append("[\(fileURL?.lastPathComponent ?? "untitled")] sidebar=\(sidebarOpen) pageOpen=\(pageOpen) window=\(Int(content.bounds.width))")
        parts.append("x=\(Int(window.window?.frame.minX ?? -1)) docs=\(files.count) files=\(files)")
        parts.append("series=\(sidebarSelection.flatMap { SeriesLibrary.shared.series($0)?.title } ?? "-")")
        parts.append("focus=\(focus) sheet=\(sheetHeight) sheetVisible=\((sheetView?.alphaValue ?? 0) > 0.5) mode=\(mode.rawValue) fill=\(Int(sheetFill)) scroll=\(editorScroll())")
        parts.append("hit=\(chain) \(pages.joined())")
        parts.append(editorGeometry(in: content, x: x))
        let line = parts.joined(separator: " ") + "\n"
        let url = FileManager.default.temporaryDirectory.appending(path: "foldmd-probe.log")
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url)
        }
    }
    #endif

    private func dragSheet(to height: CGFloat) {
        sheetDragging = true
        pulledHeight = height
    }

    private func releaseSheet(at height: CGFloat) {
        sheetDragging = false
        if height < 40 {
            // Pushed (nearly) all the way up: back to automatic.
            pulledHeight = nil
        } else {
            pulledHeight = height
            sheetHeight = height // also the limit for automatic
        }
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .navigation) {
            Button {
                toggle(.sidebar)
            } label: {
                Label(sidebarOpen ? "Hide Series" : "Show Series", systemImage: "sidebar.left")
            }
            .keyboardShortcut("s", modifiers: [.control, .command])
            .help("Slide your series out to the left, or back in (⌃⌘S)")
        }
        ToolbarItem {
            Picker("Sheet mode", selection: $mode) {
                Label("Scroll under", systemImage: "arrow.up.to.line").tag(DrawerMode.under)
                Label("Current paragraph", systemImage: "scope").tag(DrawerMode.focus)
            }
            .pickerStyle(.segmented)
            .labelStyle(.iconOnly)
            .disabled(!sheetOpen)
            .help("Scroll under: text you scroll past appears rendered. Current paragraph: renders what you're editing.")
        }
        ToolbarItem {
            Button {
                sheetOpen.toggle()
            } label: {
                Label(sheetOpen ? "Hide Sheet" : "Show Sheet",
                      systemImage: sheetOpen ? "rectangle.tophalf.inset.filled" : "rectangle.tophalf.inset")
            }
            .keyboardShortcut("\\", modifiers: .command)
            .help("Show or hide the rendered sheet (⌘\\)")
        }
        ToolbarItem {
            Button {
                toggle(.page)
            } label: {
                Label(pageOpen ? "Hide Publishing Surface" : "Show Publishing Surface",
                      systemImage: pageOpen ? "rectangle.righthalf.inset.filled" : "rectangle.split.2x1")
            }
            .keyboardShortcut("p", modifiers: [.command, .option])
            .help("Slide the publishing surface out to the right, or back in (⌥⌘P)")
        }
        ToolbarItem {
            Menu {
                Picker("Appearance", selection: $appearance) {
                    ForEach(AppearanceMode.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.inline)
            } label: {
                Label("Appearance", systemImage: colorScheme == .dark ? "moon.fill" : "sun.max.fill")
            } primaryAction: {
                appearance = colorScheme == .dark ? .light : .dark
            }
            .help("Click to switch light/dark (⇧⌘L). Hold for System, Light or Dark.")
        }
    }
}

// MARK: - Window access

/// Holds the NSWindow a SwiftUI view lives in.
@MainActor
final class WindowReference {
    weak var window: NSWindow?
}

/// An invisible view that reports which window it's in.
struct WindowReader: NSViewRepresentable {
    let reference: WindowReference
    let fileURL: URL?

    func makeNSView(context: Context) -> ReaderView { ReaderView(reference: reference, fileURL: fileURL) }
    func updateNSView(_ view: ReaderView, context: Context) {}

    final class ReaderView: NSView {
        let reference: WindowReference
        let fileURL: URL?

        init(reference: WindowReference, fileURL: URL?) {
            self.reference = reference
            self.fileURL = fileURL
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { fatalError("not used") }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            reference.window = window
            // Taking over another window's place: stay invisible until moved
            // into position, so it doesn't flash up somewhere else first.
            if let window, let fileURL, WindowHandoff.pending[SeriesLibrary.key(fileURL)] != nil {
                window.alphaValue = 0
            }
        }
    }
}

/// What a window passes to the part that replaces it.
struct WindowHandoff {
    @MainActor static var pending: [String: WindowHandoff] = [:]

    var frame: NSRect
    var sidebarOpen: Bool
    var pageOpen: Bool
    var writingWidth: CGFloat
    var pageWidth: CGFloat
    var originShift: [EditorWindow.Panel: CGFloat]
    weak var from: NSWindow?
}

// MARK: - Previews and the sheet handle

/// A rendered preview: the top sheet or the publishing surface.
struct PreviewView: NSViewRepresentable {
    let bridge: PreviewBridge

    func makeNSView(context: Context) -> WKWebView { bridge.makeWebView() }
    func updateNSView(_ view: WKWebView, context: Context) {}
}

/// The publishing surface. The page keeps its full width while only part of
/// it is showing (so text doesn't re-wrap on every frame of the slide), and is
/// pinned to the right edge. It sits in an AppKit view that clips it: SwiftUI's
/// `.clipped()` only hides drawing, so an oversized web view would still catch
/// clicks and scrolling meant for the editor next to it.
struct PageSurface: NSViewRepresentable {
    let bridge: PreviewBridge
    let contentWidth: CGFloat

    func makeNSView(context: Context) -> ContainerView {
        let view = ContainerView(content: bridge.makeWebView())
        view.onZoom = { [bridge] zoom in bridge.setZoom(zoom) }
        return view
    }

    func updateNSView(_ view: ContainerView, context: Context) {
        view.contentWidth = contentWidth
    }

    final class ContainerView: NSView {
        /// The published column (680) plus its side padding (2 × 28), from
        /// renderer.css. Narrower than this, the page is scaled down to fit,
        /// so it always shows the real layout.
        static let columnWidth: CGFloat = 736

        private let content: NSView
        var onZoom: ((Double) -> Void)?
        var contentWidth: CGFloat = 0 {
            didSet { if contentWidth != oldValue { positionContent() } }
        }

        init(content: NSView) {
            self.content = content
            super.init(frame: .zero)
            clipsToBounds = true
            addSubview(content)
        }

        required init?(coder: NSCoder) { fatalError("not used") }

        override func resizeSubviews(withOldSize oldSize: NSSize) {
            positionContent()
        }

        override func layout() {
            super.layout()
            positionContent()
        }

        private func positionContent() {
            let width = max(contentWidth, bounds.width)
            content.frame = NSRect(x: bounds.width - width, y: 0, width: width, height: bounds.height)
            if let web = content as? WKWebView, width > 0 {
                let zoom = min(1, width / Self.columnWidth)
                if abs(web.pageZoom - zoom) > 0.005 {
                    web.pageZoom = zoom
                    onZoom?(zoom)
                }
            }
        }
    }
}

/// The sheet's bottom edge: drag to pull it down or push it up.
struct SheetHandle: View {
    /// The sheet's height on screen right now; a drag starts from here.
    let currentHeight: CGFloat
    let range: ClosedRange<CGFloat>
    let onDrag: (CGFloat) -> Void
    let onEnd: (CGFloat) -> Void

    @State private var dragStart: CGFloat?
    @State private var hovering = false

    var body: some View {
        ZStack {
            Color(nsColor: Theme.sheet)
            Capsule()
                .fill(Color.secondary.opacity(hovering || dragStart != nil ? 0.6 : 0.3))
                .frame(width: 38, height: 4)
        }
        .frame(height: 12)
        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .pointerStyle(.rowResize)
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { value in
                    let start = dragStart ?? currentHeight
                    dragStart = start
                    onDrag(clamp(start + value.translation.height))
                }
                .onEnded { value in
                    let start = dragStart ?? currentHeight
                    dragStart = nil
                    onEnd(clamp(start + value.translation.height))
                }
        )
        .accessibilityLabel("Sheet height")
    }

    private func clamp(_ height: CGFloat) -> CGFloat {
        min(max(height, range.lowerBound), range.upperBound)
    }
}

/// View ▸ Typewriter Scrolling. While typing in scroll-under mode, keeps the
/// paragraph you're writing just below the sheet, so everything before it is
/// rendered above.
struct TypewriterScrollingToggle: View {
    static let key = "typing.pin"
    @AppStorage(key) private var enabled = true

    var body: some View {
        Toggle("Typewriter Scrolling", isOn: $enabled)
            .keyboardShortcut("t", modifiers: [.command, .option])
    }
}
