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

    @State private var bridge = PreviewBridge()
    @AppStorage("sheet.open") private var sheetOpen = true
    @AppStorage("sheet.height") private var sheetHeight = 220.0
    @AppStorage("sheet.mode") private var mode: DrawerMode = .under

    var body: some View {
        GeometryReader { geometry in
            let maxHeight = max(80, geometry.size.height - 60)
            let height = min(max(sheetHeight, 60), maxHeight)
            VStack(spacing: 0) {
                // Kept alive while hidden so reopening is instant.
                SheetView(bridge: bridge)
                    .frame(height: sheetOpen ? height : 0)
                    .clipped()
                if sheetOpen {
                    SheetHandle(height: $sheetHeight, range: 60...maxHeight)
                        .zIndex(1)
                }
                SourceEditor(text: $document.text, bridge: bridge)
            }
        }
        .frame(minWidth: 520, minHeight: 360)
        .toolbar {
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
                    withAnimation(.snappy(duration: 0.25)) { sheetOpen.toggle() }
                } label: {
                    Label(sheetOpen ? "Hide Sheet" : "Show Sheet", systemImage: "rectangle.tophalf.inset.filled")
                }
                .keyboardShortcut("\\", modifiers: .command)
                .help("Show or hide the rendered sheet (⌘\\)")
            }
        }
        .onChange(of: document.text, initial: true) { _, text in bridge.setText(text) }
        .onChange(of: mode, initial: true) { _, mode in bridge.setMode(mode) }
        .onChange(of: sheetOpen, initial: true) { _, open in bridge.isSheetVisible = open }
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

/// The rendered sheet at the top of the window.
struct SheetView: NSViewRepresentable {
    let bridge: PreviewBridge

    func makeNSView(context: Context) -> WKWebView { bridge.makeWebView() }
    func updateNSView(_ view: WKWebView, context: Context) {}
}

/// The sheet's bottom edge: drag to pull it down or push it up.
struct SheetHandle: View {
    @Binding var height: Double
    let range: ClosedRange<Double>

    @State private var dragStart: Double?
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
                    let start = dragStart ?? height
                    dragStart = start
                    height = min(max(start + value.translation.height, range.lowerBound), range.upperBound)
                }
                .onEnded { _ in dragStart = nil }
        )
        .accessibilityLabel("Sheet height")
    }
}
