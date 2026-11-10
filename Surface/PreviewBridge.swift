import AppKit
import WebKit

/// Owns the sheet's web view and is the only thing that talks to it.
/// Swift owns the text and the files; the web view only renders.
@MainActor
final class PreviewBridge: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var isReady = false

    private var text = ""
    private var mode: DrawerMode = .under
    private var topLine: Double = 0
    private var cursorLine = 0
    private var pendingRender: Task<Void, Never>?

    /// Called when a rendered block is clicked, with its first source line.
    var onJump: ((Int) -> Void)?

    private static let rendererURL = Bundle.main.url(forResource: "renderer", withExtension: "html")

    func makeWebView() -> WKWebView {
        if let webView { return webView }
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "surface")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = self
        view.allowsMagnification = false
        #if DEBUG
        view.isInspectable = true // Safari ▸ Develop ▸ Surface
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
        pendingRender = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(90))
            guard !Task.isCancelled, let self else { return }
            self.call("Surface.setDocument(text)", ["text": self.text])
        }
    }

    func setMode(_ newMode: DrawerMode) {
        mode = newMode
        call("Surface.setMode(mode)", ["mode": newMode.rawValue])
    }

    func scroll(topLine line: Double) {
        guard line != topLine else { return }
        topLine = line
        call("Surface.scrollToLine(line)", ["line": line])
    }

    func focus(line: Int) {
        guard line != cursorLine else { return }
        cursorLine = line
        call("Surface.focusLine(line)", ["line": line])
    }

    private func call(_ body: String, _ arguments: [String: Any]) {
        guard isReady, let webView else { return }
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .page, completionHandler: nil)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isReady = true
        call(
            "Surface.setDocument(text); Surface.scrollToLine(line); Surface.focusLine(cursor); Surface.setMode(mode);",
            ["text": text, "line": topLine, "cursor": cursorLine, "mode": mode.rawValue]
        )
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else { return .cancel }
        if url.isFileURL, url.standardizedFileURL.path == Self.rendererURL?.standardizedFileURL.path {
            return .allow
        }
        if url.isFileURL {
            // A file dropped onto the sheet: open it as a document.
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        } else if navigationAction.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
        }
        return .cancel
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              body["type"] as? String == "jump",
              let line = (body["line"] as? NSNumber)?.intValue
        else { return }
        onJump?(line)
    }
}
