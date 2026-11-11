import AppKit

/// Fonts and colours for the source editor. The rendered sheet has its own
/// stylesheet in web/src/renderer.css; keep the two roughly in step.
@MainActor
enum Theme {
    static let bodySize: CGFloat = 16
    static let headingSizes: [CGFloat] = [27, 22, 19, 17, 16, 16]

    static var body: NSFont { .systemFont(ofSize: bodySize) }
    static var mono: NSFont { .monospacedSystemFont(ofSize: 14, weight: .regular) }

    static func heading(level: Int) -> NSFont {
        .systemFont(ofSize: headingSizes[min(max(level, 1), 6) - 1], weight: .bold)
    }

    static var paragraph: NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.35
        return style
    }

    static var text: NSColor { .labelColor }
    static var marker: NSColor { .tertiaryLabelColor }
    static var quote: NSColor { .secondaryLabelColor }
    static var listMarker: NSColor { .secondaryLabelColor }
    static var math: NSColor { .systemTeal }
    static var link: NSColor { .linkColor }

    static var baseAttributes: [NSAttributedString.Key: Any] {
        [.font: body, .foregroundColor: text, .paragraphStyle: paragraph]
    }

    /// Background of the rendered sheet (matches --bg in renderer.css).
    static let sheet = NSColor(name: "FoldSheet") { appearance in
        if appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua {
            return NSColor(srgbRed: 0.098, green: 0.098, blue: 0.106, alpha: 1)
        }
        return NSColor(srgbRed: 0.957, green: 0.953, blue: 0.937, alpha: 1)
    }
}
