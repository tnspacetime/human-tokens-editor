import AppKit
import UniformTypeIdentifiers
import WebKit

/// Lets the previews show images from your disk. The renderer turns each
/// local image link into `fold-asset://image/<absolute path>`, and this hands
/// out the file, as long as it's an image (nothing else can be read this way).
@MainActor
final class LocalImageScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "fold-asset"

    private static let types: [String: String] = [
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
        "webp": "image/webp", "heic": "image/heic", "heif": "image/heif", "avif": "image/avif",
        "tif": "image/tiff", "tiff": "image/tiff", "bmp": "image/bmp", "svg": "image/svg+xml",
    ]

    /// Requests in flight; one that WebKit stops is dropped from here, so
    /// it's never answered after it was cancelled.
    private var pending: [ObjectIdentifier: any WKURLSchemeTask] = [:]

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url,
              let mime = Self.types[url.pathExtension.lowercased()]
        else {
            task.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let path = url.path(percentEncoded: false)
        let id = ObjectIdentifier(task)
        pending[id] = task
        Task {
            let data = await Self.read(path)
            guard let task = pending.removeValue(forKey: id) else { return }
            guard let data else {
                task.didFailWithError(URLError(.fileDoesNotExist))
                return
            }
            task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: nil))
            task.didReceive(data)
            task.didFinish()
        }
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        pending.removeValue(forKey: ObjectIdentifier(task))
    }

    /// Reads off the main thread (a large photo shouldn't stall typing).
    nonisolated private static func read(_ path: String) async -> Data? {
        FileManager.default.contents(atPath: path)
    }
}

/// Brings images into a document: dragged or pasted images are copied into an
/// "images" folder next to it, and a link is written for each. (A link you
/// type yourself is left as it is; publishing uploads whatever it points to.)
@MainActor
enum ImageImporter {
    static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "avif", "tif", "tiff", "bmp", "svg"]

    static func isImage(_ url: URL) -> Bool {
        imageExtensions.contains(url.pathExtension.lowercased())
    }

    /// Where images for this document go: "images" beside it. An untitled
    /// document has no folder yet, so its images wait in the app's own
    /// folder (and are linked by their full path) until you move them.
    static func folder(for document: URL?) -> URL {
        if let document {
            return document.deletingLastPathComponent().appending(path: "images", directoryHint: .isDirectory)
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appending(path: "Fold MD/Unsaved Images", directoryHint: .isDirectory)
    }

    /// Copies an image file in and returns the markdown for it.
    static func importFile(_ source: URL, into document: URL?) throws -> String {
        let data = try Data(contentsOf: source)
        return try store(data, named: source.lastPathComponent, into: document)
    }

    /// Saves raw image data (a paste, or a browser drag) and returns the markdown.
    static func importData(_ data: Data, type: UTType, into document: URL?) throws -> String {
        // Local time, like screenshots: image-2026-11-11-091722.png
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        let name = "image-\(formatter.string(from: Date())).\(type.preferredFilenameExtension ?? "png")"
        return try store(data, named: name, into: document)
    }

    /// Image data on a pasteboard, as PNG when it isn't already PNG/JPEG/GIF.
    static func imageData(from pasteboard: NSPasteboard) -> (Data, UTType)? {
        for type in [UTType.png, .jpeg, .gif] {
            if let data = pasteboard.data(forType: NSPasteboard.PasteboardType(type.identifier)) { return (data, type) }
        }
        if let tiff = pasteboard.data(forType: .tiff),
           let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            return (png, .png)
        }
        return nil
    }

    private static func store(_ data: Data, named original: String, into document: URL?) throws -> String {
        let folder = folder(for: document)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let target = destination(for: original, data: data, in: folder)
        if !FileManager.default.fileExists(atPath: target.path) {
            try data.write(to: target)
        }
        let alt = (original as NSString).deletingPathExtension
            .replacingOccurrences(of: "[\\[\\]]", with: "", options: .regularExpression)
        let link = document == nil ? target.path : "images/" + target.lastPathComponent
        return "![\(alt)](\(markdownPath(link)))"
    }

    /// A name that's safe in a link (no spaces or brackets). An identical
    /// file already there is reused; a different one gets "-2", "-3"...
    private static func destination(for original: String, data: Data, in folder: URL) -> URL {
        let ext = (original as NSString).pathExtension.lowercased()
        var base = (original as NSString).deletingPathExtension
            .replacingOccurrences(of: "[\\s()\\[\\]<>#?%]+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-."))
        if base.isEmpty { base = "image" }
        var candidate = folder.appending(path: "\(base).\(ext)")
        var n = 2
        while FileManager.default.fileExists(atPath: candidate.path) {
            if (try? Data(contentsOf: candidate)) == data { return candidate }
            candidate = folder.appending(path: "\(base)-\(n).\(ext)")
            n += 1
        }
        return candidate
    }

    /// Markdown can't take spaces in a plain link; <...> can.
    private static func markdownPath(_ path: String) -> String {
        path.contains(" ") || path.contains(")") ? "<\(path)>" : path
    }
}
