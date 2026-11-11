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

    @State private var sheet = PreviewBridge(role: .sheet)
    @State private var page = PreviewBridge(role: .page)
    @State private var window = WindowReference()

    /// The publishing surface: a second half that slides out of the writing
    /// surface's right edge (the window grows to make room) and back in.
    @State private var pageOpen = false
    /// The writing half's width while the page is out. It doesn't change.
    @State private var writingWidth: CGFloat = 0
    /// The page's width when fully out.
    @State private var pageWidth: CGFloat = 0
    @State private var isSliding = false
    /// Where the window was before it had to shift left to make room, and
    /// where it ended up; it goes back on close unless you moved it.
    @State private var shiftedFromX: CGFloat?
    @State private var shiftedToX: CGFloat?

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
        GeometryReader { geometry in
            let total = geometry.size.width
            let writing = pageOpen ? min(writingWidth, total) : total
            let revealed = max(0, total - writing - 1)
            HStack(spacing: 0) {
                editorColumn(height: geometry.size.height)
                    .frame(width: writing)

                // The hinge between the two halves.
                Rectangle()
                    .fill(Color(nsColor: .separatorColor))
                    .frame(width: pageOpen ? 1 : 0)

                // Pinned to the window's right edge, so as the window grows
                // the page slides out from behind the hinge (and back in).
                // Always present so it's loaded before it's needed.
                PageSurface(bridge: page, contentWidth: pageOpen ? pageWidth : 0)
                    .frame(width: pageOpen ? revealed : 0)
            }
            .onChange(of: geometry.size.height, initial: true) { _, height in contentHeight = height }
        }
        .onAppear {
            let fill = $sheetFill
            sheet.onFill = { height in
                if abs(fill.wrappedValue - height) >= 1 { fill.wrappedValue = height }
            }
        }
        .frame(minWidth: 520, minHeight: 360)
        .background(WindowReader(reference: window))
        .toolbar { toolbar }
        .onChange(of: document.text, initial: true) { _, text in
            sheet.setText(text)
            page.setText(text)
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
        #if DEBUG
        // Lets tests toggle the publishing surface without keystrokes:
        // a distributed notification named "md.fold.app.togglePage".
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.togglePage"))) { _ in
            togglePage()
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
        // Scrolls the editor down 400pt ("md.fold.app.scroll").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.scroll"))) { _ in
            @MainActor func scrollViews(in view: NSView) -> [NSScrollView] {
                view.subviews.flatMap { ($0 as? NSScrollView).map { [$0] } ?? scrollViews(in: $0) }
            }
            guard let content = window.window?.contentView,
                  let scroll = scrollViews(in: content).first(where: { $0.documentView is FoldTextView }) else { return }
            scroll.contentView.scroll(to: NSPoint(x: 0, y: scroll.contentView.bounds.minY + 400))
            scroll.reflectScrolledClipView(scroll.contentView)
        }
        // Logs which view would receive a click/scroll in the middle of the
        // writing surface ("md.fold.app.probe").
        .onReceive(DistributedNotificationCenter.default().publisher(for: .init("md.fold.app.probe"))) { _ in
            guard let content = window.window?.contentView else { return }
            let x = (pageOpen ? min(writingWidth, content.bounds.width) : content.bounds.width) * 0.5
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
            let line = "pageOpen=\(pageOpen) window=\(Int(content.bounds.width)) docs=\(NSDocumentController.shared.documents.count) files=\(NSDocumentController.shared.documents.map { $0.fileURL?.lastPathComponent ?? "untitled" }) "
                + "focus=\(focus) sheet=\(Int(sheetView?.frame.height ?? -1)) fill=\(Int(sheetFill)) scroll=\(editorScroll()) hit=\(chain) \(pages.joined())\n"
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
    }

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

    // MARK: Sliding the publishing surface

    private static let slideDuration = 0.36
    private static let minPageWidth: CGFloat = 480

    private func togglePage() {
        guard !isSliding else { return }
        guard let window = window.window, !window.styleMask.contains(.fullScreen) else {
            // Full screen: the window can't grow, so split it in half instead.
            let width = window.window?.frame.width ?? 1000
            writingWidth = width / 2
            pageWidth = width / 2
            pageOpen.toggle()
            return
        }

        var frame = window.frame
        if !pageOpen {
            // Grow to the right by the page's width, within the screen. If
            // there isn't room, shift left; if the screen is too narrow even
            // then, the writing surface gives up some width.
            let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? frame
            let current = frame.width
            let desired = min(max(preferredPageWidth, Self.minPageWidth), 1400)
            let target = min(current + desired, screen.width)
            pageWidth = max(target - current, min(desired, target / 2))
            writingWidth = target - pageWidth
            frame.size.width = target
            shiftedFromX = nil
            if frame.maxX > screen.maxX {
                shiftedFromX = frame.origin.x
                frame.origin.x = max(screen.minX, screen.maxX - target)
                shiftedToX = frame.origin.x
            }
            pageOpen = true
            slide(window, to: frame) {}
        } else {
            // Remember the page width you ended up with (you may have resized).
            let shown = frame.width - min(writingWidth, frame.width) - 1
            if shown >= Self.minPageWidth { preferredPageWidth = shown }
            frame.size.width = min(writingWidth, frame.width)
            if let from = shiftedFromX, let to = shiftedToX, abs(frame.origin.x - to) < 1 {
                frame.origin.x = from
            }
            shiftedFromX = nil
            slide(window, to: frame) { pageOpen = false }
        }
    }

    private func slide(_ window: NSWindow, to frame: NSRect, completion: @escaping @MainActor () -> Void) {
        isSliding = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.slideDuration
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrame(frame, display: true)
        } completionHandler: {
            Task { @MainActor in
                completion()
                isSliding = false
            }
        }
    }

    // MARK: Layout

    private func editorColumn(height: CGFloat) -> some View {
        VStack(spacing: 0) {
            // Kept alive while hidden so reopening is instant.
            PreviewView(bridge: sheet)
                .frame(height: sheetMotion.value)
                .clipped()
            if sheetOpen {
                SheetHandle(currentHeight: sheetMotion.value, range: 0...maxSheetHeight,
                            onDrag: dragSheet, onEnd: releaseSheet)
                    .zIndex(1)
            }
            SourceEditor(text: $document.text, sheet: sheet, page: page)
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
                togglePage()
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

    func makeNSView(context: Context) -> ReaderView { ReaderView(reference: reference) }
    func updateNSView(_ view: ReaderView, context: Context) {}

    final class ReaderView: NSView {
        let reference: WindowReference

        init(reference: WindowReference) {
            self.reference = reference
            super.init(frame: .zero)
        }

        required init?(coder: NSCoder) { fatalError("not used") }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            reference.window = window
        }
    }
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
