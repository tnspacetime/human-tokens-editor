// A plain gradient stage behind Fold MD while the demo is recorded, so the
// recording shows no desktop, icons or other windows. Runs until killed.
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

// The display with the menu bar (where the recording is made), not the
// one that happens to have the key window.
let screen = NSScreen.screens[0]
let window = NSWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
window.level = .normal
window.ignoresMouseEvents = true
window.hasShadow = false

let view = NSView(frame: screen.frame)
view.wantsLayer = true
let gradient = CAGradientLayer()
gradient.frame = view.bounds
gradient.colors = [
    NSColor(srgbRed: 0.20, green: 0.25, blue: 0.38, alpha: 1).cgColor,
    NSColor(srgbRed: 0.42, green: 0.36, blue: 0.52, alpha: 1).cgColor,
    NSColor(srgbRed: 0.78, green: 0.58, blue: 0.50, alpha: 1).cgColor,
]
gradient.startPoint = CGPoint(x: 0, y: 1)
gradient.endPoint = CGPoint(x: 1, y: 0)
view.layer = gradient
window.contentView = view
// Come forward over every other app; Fold MD then opens in front of it.
app.activate(ignoringOtherApps: true)
window.makeKeyAndOrderFront(nil)
window.orderFrontRegardless()

app.run()
