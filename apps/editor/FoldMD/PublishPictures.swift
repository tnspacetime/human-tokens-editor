import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// The pictures a piece uses, made ready for the site and sent before its
/// text. Each local picture is shrunk to at most 2000 pixels on its long
/// side, turned the right way up, and written afresh, so nothing else in
/// the file goes along: not the place it was taken, not the camera, not
/// the time. Photos go as JPEG (HEIC included: most browsers can't show
/// it), screenshots and drawings as PNG, animated GIFs as they are.
///
/// The site stores each picture under the SHA-256 of its bytes, and the
/// markdown sent links it as /img/<hash>. The file on your Mac keeps its
/// links as you wrote them. Web links (https:) go as they are.
enum PublishPictures {
    static let maxSide = 2000
    // The site's limits (apps/site/src/server/images.server.ts).
    static let maxBytes = 5_000_000
    static let perPiece = 20
    static let perPieceBytes = 10_000_000

    struct Picture: Sendable {
        let data: Data
        let type: String
        let hash: String
    }

    enum Problem: LocalizedError {
        case missing(String)
        case unreadable(String)
        case svg(String)
        case tooBig(String)
        case tooMany(Int)
        case tooMuch(Int)

        var errorDescription: String? {
            switch self {
            case .missing(let link): "A picture this piece uses isn't on your Mac: \(link). Put it back, or take it out of the piece."
            case .unreadable(let name): "“\(name)” isn't a picture Fold MD can read."
            case .svg(let name): "SVG pictures can't be published yet: “\(name)”. Export it as a PNG and link that."
            case .tooBig(let name): "“\(name)” is still more than \(maxBytes / 1_000_000) MB once made smaller. Try saving it as a JPEG."
            case .tooMany(let count): "A piece can have at most \(perPiece) pictures. This one has \(count)."
            case .tooMuch(let bytes): "The pictures in a piece can come to at most \(perPieceBytes / 1_000_000) MB. These come to \(Int((Double(bytes) / 1_000_000).rounded())) MB."
            }
        }
    }

    // MARK: Links

    /// How many local pictures `markdown` links (the same file once).
    static func count(in markdown: String, base: URL?) -> Int {
        var files = Set<String>()
        _ = rewriteLinks(in: markdown) { link in
            files.insert(localFile(link, base: base)?.path ?? link)
            return nil
        }
        return files.count
    }

    /// Links to pictures on this Mac, relative to `base`, made absolute: a
    /// series' parts can sit in different folders, and are joined into one
    /// piece.
    static func absolutize(_ markdown: String, base: URL) -> String {
        rewriteLinks(in: markdown) { link in
            guard let file = localFile(link, base: base) else { return nil }
            return "<\(file.path)>"
        }
    }

    /// Every local picture in `markdown` made ready, and the markdown to
    /// send, with each linked as /img/<hash>. Slow for big photos: call it
    /// off the main thread.
    static func ready(_ markdown: String, base: URL?) throws -> (markdown: String, pictures: [Picture]) {
        var byFile: [String: Picture] = [:]
        var pictures: [Picture] = []
        var problem: Error?
        let sent = rewriteLinks(in: markdown) { link in
            guard problem == nil else { return nil }
            guard let file = localFile(link, base: base) else { return nil }
            do {
                let picture: Picture
                if let known = byFile[file.path] {
                    picture = known
                } else {
                    guard FileManager.default.fileExists(atPath: file.path) else { throw Problem.missing(link) }
                    picture = try prepare(file)
                    byFile[file.path] = picture
                    if !pictures.contains(where: { $0.hash == picture.hash }) { pictures.append(picture) }
                }
                return "/img/\(picture.hash)"
            } catch {
                problem = error
                return nil
            }
        }
        if let problem { throw problem }
        if pictures.count > perPiece { throw Problem.tooMany(pictures.count) }
        let total = pictures.reduce(0) { $0 + $1.data.count }
        if total > perPieceBytes { throw Problem.tooMuch(total) }
        return (sent, pictures)
    }

    /// The file a picture link points at on this Mac, or nil for a web link
    /// (or a relative one with no folder to start from). As the preview
    /// reads them (web/src/renderer.js): relative, absolute, ~/ or file:.
    static func localFile(_ link: String, base: URL?) -> URL? {
        let decoded = link.removingPercentEncoding ?? link
        if link.lowercased().hasPrefix("file:") { return URL(string: link).map { URL(fileURLWithPath: $0.path) } }
        if link.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) != nil { return nil }
        if link.hasPrefix("/") { return URL(fileURLWithPath: decoded).standardizedFileURL }
        if link.hasPrefix("~/") {
            return FileManager.default.homeDirectoryForCurrentUser.appending(path: String(decoded.dropFirst(2))).standardizedFileURL
        }
        guard let base else { return nil }
        return base.appending(path: decoded).standardizedFileURL
    }

    /// Calls `change` with each picture link's destination as written
    /// (without <>), outside code, and puts back what it returns (nil
    /// leaves it). Inline pictures ![alt](link "title") and reference
    /// definitions [name]: link, which only pictures use in practice.
    static func rewriteLinks(in markdown: String, _ change: (String) -> String?) -> String {
        var lines = markdown.components(separatedBy: "\n")
        var fence: String?
        for index in lines.indices {
            let line = lines[index]
            let trimmed = line.drop { $0 == " " }
            if line.count - trimmed.count < 4, let marker = trimmed.first, marker == "`" || marker == "~" {
                let run = String(trimmed.prefix { $0 == marker })
                if run.count >= 3 {
                    if fence == nil { fence = run } else if let open = fence, run.first == open.first, run.count >= open.count { fence = nil }
                    continue
                }
            }
            guard fence == nil, line.contains("](") || line.contains("]:") else { continue }
            lines[index] = rewriteLine(line, change)
        }
        return lines.joined(separator: "\n")
    }

    private static let inlinePicture = try! NSRegularExpression(
        pattern: #"!\[(?:[^\]\\]|\\.)*\]\(\s*(<[^>\n]*>|[^\s()<>]+(?:\([^\s()]*\)[^\s()<>]*)*)"#)
    private static let definition = try! NSRegularExpression(
        pattern: #"^ {0,3}\[[^\]]+\]:\s*(<[^>\n]*>|\S+)"#)
    private static let codeSpan = try! NSRegularExpression(pattern: #"(`+).*?\1"#)

    private static func rewriteLine(_ line: String, _ change: (String) -> String?) -> String {
        let text = line as NSString
        let whole = NSRange(location: 0, length: text.length)
        let code = codeSpan.matches(in: line, range: whole).map(\.range)
        var edits: [(NSRange, String)] = []
        for match in inlinePicture.matches(in: line, range: whole) + definition.matches(in: line, range: whole) {
            let range = match.range(at: 1)
            guard !code.contains(where: { NSIntersectionRange($0, match.range).length > 0 }) else { continue }
            var link = text.substring(with: range)
            if link.hasPrefix("<") { link = String(link.dropFirst().dropLast()) }
            guard !link.isEmpty, let replacement = change(link) else { continue }
            edits.append((range, replacement))
        }
        let result = NSMutableString(string: line)
        for (range, replacement) in edits.sorted(by: { $0.0.location > $1.0.location }) {
            result.replaceCharacters(in: range, with: replacement)
        }
        return result as String
    }

    // MARK: Pictures

    /// One picture, ready to send.
    static func prepare(_ file: URL) throws -> Picture {
        let name = file.lastPathComponent
        if file.pathExtension.lowercased() == "svg" { throw Problem.svg(name) }
        guard let source = CGImageSourceCreateWithURL(file as CFURL, nil), CGImageSourceGetCount(source) > 0 else {
            throw Problem.unreadable(name)
        }
        let sourceType = CGImageSourceGetType(source) as String?

        // An animated GIF goes as it is: making it smaller would stop it
        // moving. (GIFs don't carry a place or a camera.)
        if sourceType == UTType.gif.identifier, CGImageSourceGetCount(source) > 1 {
            guard let data = try? Data(contentsOf: file) else { throw Problem.unreadable(name) }
            guard data.count <= maxBytes else { throw Problem.tooBig(name) }
            return Picture(data: data, type: "image/gif", hash: hash(data))
        }

        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? maxSide
        let height = properties?[kCGImagePropertyPixelHeight] as? Int ?? maxSide
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true, // the right way up
            kCGImageSourceThumbnailMaxPixelSize: min(maxSide, max(width, height)),
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw Problem.unreadable(name)
        }

        // PNG keeps screenshots and drawings sharp, and see-through parts;
        // photos go as JPEG. Only the pixels are written: none of the
        // original file's details come along.
        let seeThrough = properties?[kCGImagePropertyHasAlpha] as? Bool ?? false
        let drawn = [UTType.png.identifier, UTType.gif.identifier].contains(sourceType)
        let asPNG = drawn || (seeThrough && sourceType != UTType.jpeg.identifier)
        var data = encode(image, as: asPNG ? .png : .jpeg)
        if asPNG, !seeThrough, let png = data, png.count > maxBytes {
            data = encode(image, as: .jpeg) // a photo saved as PNG
        }
        guard let data else { throw Problem.unreadable(name) }
        guard data.count <= maxBytes else { throw Problem.tooBig(name) }
        let type = data.starts(with: [0x89, 0x50]) ? "image/png" : "image/jpeg"
        return Picture(data: data, type: type, hash: hash(data))
    }

    private static func encode(_ image: CGImage, as type: UTType) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil) else { return nil }
        var properties: [CFString: Any] = [:]
        if type == .jpeg { properties[kCGImageDestinationLossyCompressionQuality] = 0.82 }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }

    private static func hash(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
