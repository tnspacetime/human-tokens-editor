import AppKit
import WebKit

/// Owns one preview web view (the top sheet or the side page) and is the
/// only thing that talks to it. Swift owns the text and the files; the web
/// view only renders.
@MainActor
final class PreviewBridge: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    enum Role {
        /// The pull-down sheet above the editor (scroll-under / current paragraph).
        case sheet
        /// The publishing surface: the document as a published page, beside the editor.
        case page
    }

    let role: Role

    private weak var webView: WKWebView?
    private var isReady = false

    private var text = ""
    /// Sheet mode; ignored by the page.
    private(set) var mode: DrawerMode = .under
    private var topLine: Double = 0
    /// Sheet only: how far the editor's column is moved right of centre and
    /// made narrower (to make room for notes), so the text lines up.
    private var columnShift: Double = 0
    private var columnNarrower: Double = 0
    private var cursorLine = 0
    /// Page only: where the editor's top line sits on screen, as the editor's
    /// top edge in the window plus any padding showing above its first line.
    private var anchorBase: Double = 0
    private var anchorGap: Double = 28
    /// Page only: how much the page is scaled down to fit its half. The
    /// anchor is in screen points; the page measures in its own (zoomed) px.
    private var zoom: Double = 1
    private var anchor: Double { (anchorBase + anchorGap) / zoom }

    func setZoom(_ newZoom: Double) {
        guard abs(newZoom - zoom) > 0.001, newZoom > 0 else { return }
        zoom = newZoom
        call("Fold.setAnchor(y)", ["y": anchor])
    }
    private var pendingRender: Task<Void, Never>?

    /// Whether this preview is on screen. A hidden preview keeps track of the
    /// latest state but doesn't render until it's shown again.
    var isActive = true {
        didSet { if isActive, !oldValue { pushState() } }
    }

    /// Called when a rendered block is clicked, with its first source line.
    var onJump: ((Int) -> Void)?
    /// Sheet only: how tall the rendered text above the editor is, in points.
    var onFill: ((CGFloat) -> Void)?
    /// Whether this preview has painted its first document (it's invisible
    /// until then, so it never flashes white or empty).
    private(set) var hasPainted = false

    /// Page only: a previous/next link was clicked.
    var onOpenPart: ((URL) -> Void)?
    /// Page only: where this document sits in a series.
    private var series: SeriesNavigation?

    /// Sheet only: scrolls the editor by this many points, so when the sheet
    /// grows or shrinks the text stays still and the sheet's edge slides over
    /// it (covering lines, which then appear rendered, or uncovering them).
    var shiftEditor: ((CGFloat) -> Void)?

    private static let rendererURL = Bundle.main.url(forResource: "renderer", withExtension: "html")

    init(role: Role) {
        self.role = role
    }

    private var jsMode: String {
        role == .page ? "page" : mode.rawValue
    }

    func makeWebView() -> WKWebView {
        if let webView { return webView }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "fold")
        configuration.setURLSchemeHandler(LocalImageScheme(), forURLScheme: LocalImageScheme.scheme)
        let view = PreviewWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsMagnification = false
        // Invisible, and transparent behind its content, until the first
        // render has been painted; the app's own background shows instead.
        view.alphaValue = 0
        view.setValue(false, forKey: "drawsBackground")
        #if DEBUG
        view.isInspectable = true // Safari ▸ Develop ▸ Fold MD
        #endif
        if let url = Self.rendererURL {
            view.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
        webView = view
        return view
    }

    // MARK: Inputs from the editor

    func setText(_ newText: String) {
        guard newText != text else { return }
        text = newText
        pendingRender?.cancel()
        // Hidden: showing it again sends the text as it is then.
        guard isActive else { return }
        pendingRender = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled, let self else { return }
            self.call("Fold.setDocument(text)", ["text": self.text])
        }
    }

    func setMode(_ newMode: DrawerMode) {
        mode = newMode
        call("Fold.setMode(mode)", ["mode": jsMode])
    }

    func scroll(topLine line: Double) {
        guard line != topLine else { return }
        topLine = line
        call("Fold.scrollToLine(line)", ["line": line])
    }

    func setAnchor(_ y: Double) {
        guard y != anchorBase else { return }
        anchorBase = y
        call("Fold.setAnchor(y)", ["y": anchor])
    }

    func setTopGap(_ gap: Double) {
        guard gap != anchorGap else { return }
        anchorGap = gap
        call("Fold.setAnchor(y)", ["y": anchor])
    }

    /// The folder image links are relative to: the document's own folder
    /// (nil while untitled).
    private var baseDirectory: String?
    private static let home = FileManager.default.homeDirectoryForCurrentUser.path(percentEncoded: false)

    func setDocumentURL(_ url: URL?) {
        let base = url.map { $0.deletingLastPathComponent().path(percentEncoded: false) }
            .map { $0.hasSuffix("/") ? $0 : $0 + "/" }
        guard base != baseDirectory else { return }
        baseDirectory = base
        call("Fold.setBase(base, home)", ["base": base ?? NSNull(), "home": Self.home])
    }

    func setSeries(_ navigation: SeriesNavigation?) {
        guard navigation != series else { return }
        series = navigation
        call("Fold.setSeries(info)", ["info": seriesInfo])
    }

    /// The series as plain JSON values for the page.
    private var seriesInfo: Any {
        guard let series else { return NSNull() }
        func neighbour(_ n: SeriesNavigation.Neighbour?) -> Any {
            n.map { ["title": $0.title, "path": $0.path] } ?? NSNull()
        }
        return ["title": series.title, "index": series.index, "count": series.count,
                "previous": neighbour(series.previous), "next": neighbour(series.next)]
    }

    func setColumn(shift: Double, narrower: Double) {
        guard role == .sheet, shift != columnShift || narrower != columnNarrower else { return }
        columnShift = shift
        columnNarrower = narrower
        call("Fold.setColumn(shift, narrower)", ["shift": shift, "narrower": narrower])
    }

    func focus(line: Int) {
        guard line != cursorLine else { return }
        cursorLine = line
        call("Fold.focusLine(line)", ["line": line])
    }

    /// Sends everything at once: after loading, or when shown again.
    private func pushState() {
        pendingRender?.cancel()
        call(
            "Fold.setBase(base, home); Fold.setDocument(text); Fold.setSeries(series); Fold.setAnchor(anchor); Fold.scrollToLine(line); Fold.focusLine(cursor); Fold.setColumn(shift, narrower); Fold.setMode(mode);",
            ["shift": columnShift, "narrower": columnNarrower, "base": baseDirectory ?? NSNull(), "home": Self.home, "text": text, "series": seriesInfo, "anchor": anchor, "line": topLine, "cursor": cursorLine, "mode": jsMode]
        )
    }

    private func call(_ body: String, _ arguments: [String: Any]) {
        guard isReady, isActive, let webView else { return }
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page, completionHandler: nil)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isReady = true
        pushState()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.isFileURL, url.standardizedFileURL.path == Self.rendererURL?.standardizedFileURL.path {
            return .allow
        }
        if url.isFileURL {
            // A file dropped onto a preview: open it as a document.
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        } else if navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
        }
        return .cancel
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch body["type"] as? String {
        case "jump":
            if let line = (body["line"] as? NSNumber)?.intValue { onJump?(line) }
        case "painted":
            hasPainted = true
            webView?.alphaValue = 1
        case "openPart":
            if let path = body["path"] as? String { onOpenPart?(URL(fileURLWithPath: path)) }
        case "fill":
            if let height = (body["height"] as? NSNumber)?.doubleValue { onFill?(CGFloat(height)) }
        default:
            break
        }
    }
}

/// A preview never takes keyboard focus on its own (so a new window's cursor
/// lands in the text, and typing always goes to the editor). Clicking into a
/// preview still focuses it, e.g. to select and copy rendered text.
final class PreviewWebView: WKWebView {
    override var acceptsFirstResponder: Bool {
        guard let event = NSApp.currentEvent else { return false }
        return [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type)
    }
}
