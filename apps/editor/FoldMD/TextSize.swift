import AppKit
import SwiftUI

/// View ▸ Bigger Text / Smaller Text / Actual Size: how big the writing is
/// in the editor, for every window, remembered between launches. The
/// column stays as wide as the published page, so bigger text means fewer
/// words to a line. The sheet beside it shows the page as readers see it,
/// so it doesn't change.
@MainActor
enum TextSize {
    static let key = "textSize"
    /// The body text's size in points; headings and code follow it.
    static let sizes: [CGFloat] = [12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 28, 32]
    static let standard: CGFloat = 16
    static let changed = Notification.Name("FoldTextSizeChanged")

    static var current: CGFloat {
        let saved = CGFloat(UserDefaults.standard.double(forKey: key))
        return sizes.contains(saved) ? saved : standard
    }

    /// How much bigger than standard everything in the editor is drawn.
    static var scale: CGFloat { current / standard }

    static var canGrow: Bool { current < sizes.last! }
    static var canShrink: Bool { current > sizes.first! }

    static func grow() { set(sizes.first { $0 > current } ?? current) }
    static func shrink() { set(sizes.last { $0 < current } ?? current) }
    static func reset() { set(standard) }

    private static func set(_ size: CGFloat) {
        guard size != current else { return }
        UserDefaults.standard.set(Double(size), forKey: key)
        NotificationCenter.default.post(name: changed, object: nil)
    }
}

struct TextSizeMenu: View {
    // Read so the items enable and disable as the size changes.
    @AppStorage(TextSize.key) private var size: Double = Double(TextSize.standard)

    var body: some View {
        Button("Bigger Text") { TextSize.grow() }
            .keyboardShortcut("+", modifiers: .command)
            .disabled(!TextSize.canGrow)
        Button("Smaller Text") { TextSize.shrink() }
            .keyboardShortcut("-", modifiers: .command)
            .disabled(!TextSize.canShrink)
        Button("Actual Size") { TextSize.reset() }
            .keyboardShortcut("0", modifiers: .command)
            .disabled(TextSize.current == TextSize.standard)
    }
}

/// The publishing surface's own text size: the page zoomed, as a reader
/// would zoom it in a browser (the text re-wraps to fit). Separate from the
/// editor's, since you may want to write small and read big, or the other
/// way round.
@MainActor
enum PageTextSize {
    static let key = "pageTextSize"
    static let scales: [Double] = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2]
    static let changed = Notification.Name("FoldPageTextSizeChanged")

    static var current: Double {
        let saved = UserDefaults.standard.double(forKey: key)
        return scales.contains(saved) ? saved : 1
    }

    static func grow() { set(scales.first { $0 > current } ?? current) }
    static func shrink() { set(scales.last { $0 < current } ?? current) }

    private static func set(_ scale: Double) {
        guard scale != current else { return }
        UserDefaults.standard.set(scale, forKey: key)
        NotificationCenter.default.post(name: changed, object: nil)
    }
}
