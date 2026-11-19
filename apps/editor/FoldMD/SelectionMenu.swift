import AppKit

/// The small dark (in Dark Mode, grey) menu that appears over selected text when you let go of
/// the mouse, as on iPhone and iPad: Cut, Copy, Paste, Add Note. It goes
/// away as soon as you type, click elsewhere or scroll. Selecting with the
/// keyboard doesn't show it (you're mid-edit).
@MainActor
final class SelectionMenu: NSView {
    struct Item {
        let title: String
        let enabled: Bool
        let action: () -> Void
    }

    private var buttons: [NSButton] = []
    private var actions: [() -> Void] = []
    /// Where the little arrow points (x within the menu), and which side.
    private var arrowX: CGFloat = 0
    private var pointsDown = true
    private static let arrow: CGFloat = 7
    private static let height: CGFloat = 34

    override var isFlipped: Bool { true }

    init() {
        super.init(frame: .zero)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { fatalError() }

    /// Shows the menu above `target` (a rect in `host`), or below it when
    /// there's no room above.
    func show(_ items: [Item], over target: NSRect, in host: NSView, visible: NSRect) {
        for button in buttons { button.removeFromSuperview() }
        buttons = []
        actions = items.map(\.action)
        var x: CGFloat = 0
        for (index, item) in items.enumerated() {
            let button = NSButton(title: item.title, target: self, action: #selector(clicked(_:)))
            button.tag = index
            button.isBordered = false
            button.isEnabled = item.enabled
            button.attributedTitle = NSAttributedString(string: item.title, attributes: [
                .foregroundColor: NSColor.white.withAlphaComponent(item.enabled ? 1 : 0.35),
                .font: NSFont.systemFont(ofSize: 13, weight: .regular),
            ])
            let width = ceil(button.attributedTitle.size().width) + 26
            button.frame = NSRect(x: x, y: 0, width: width, height: Self.height)
            addSubview(button)
            buttons.append(button)
            x += width + 1 // a hairline between items
        }
        let width = x - 1
        let roomAbove = target.minY - visible.minY > Self.height + Self.arrow + 10
        pointsDown = roomAbove
        let left = min(max(target.midX - width / 2, visible.minX + 8), visible.maxX - width - 8)
        let top = roomAbove ? target.minY - Self.height - Self.arrow - 4 : target.maxY + 4
        frame = NSRect(x: left, y: top, width: width, height: Self.height + Self.arrow)
        for button in buttons { button.frame.origin.y = pointsDown ? 0 : Self.arrow }
        arrowX = min(max(target.midX - left, 16), width - 16)

        if superview !== host { host.addSubview(self) }
        needsDisplay = true
        alphaValue = 0
        layer?.setAffineTransform(CGAffineTransform(scaleX: 0.94, y: 0.94))
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.16
            context.allowsImplicitAnimation = true
            animator().alphaValue = 1
            layer?.setAffineTransform(.identity)
        }
    }

    func hide() {
        guard superview != nil else { return }
        removeFromSuperview()
    }

    var isShowing: Bool { superview != nil }

    @objc private func clicked(_ sender: NSButton) {
        let action = actions[sender.tag]
        hide()
        action()
    }

    override func draw(_ dirtyRect: NSRect) {
        let body = NSRect(x: 0, y: pointsDown ? 0 : Self.arrow, width: bounds.width, height: Self.height)
        let path = NSBezierPath(roundedRect: body, xRadius: 9, yRadius: 9)
        let a = Self.arrow
        let tip = NSPoint(x: arrowX, y: pointsDown ? body.maxY + a : body.minY - a)
        let base = pointsDown ? body.maxY - 0.5 : body.minY + 0.5
        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: arrowX - a, y: base))
        arrow.line(to: tip)
        arrow.line(to: NSPoint(x: arrowX + a, y: base))
        arrow.close()
        Theme.floating.setFill()
        path.fill()
        arrow.fill()
        // Hairlines between items.
        NSColor.white.withAlphaComponent(0.18).setFill()
        for button in buttons.dropLast() {
            NSRect(x: button.frame.maxX, y: body.minY + 8, width: 1, height: body.height - 16).fill()
        }
    }

    // Clicks on the menu's own background don't fall through to the text.
    override func mouseDown(with event: NSEvent) {}
}
