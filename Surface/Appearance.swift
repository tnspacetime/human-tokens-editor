import AppKit
import SwiftUI

/// View ▸ Appearance: follow the system, or force light or dark.
/// Everything follows it: the window, the editor's colours, and the sheet
/// (WebKit resolves `prefers-color-scheme` from the app's appearance).
enum AppearanceMode: String, CaseIterable, Identifiable {
    case system, light, dark

    static let key = "appearance"

    var id: Self { self }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    @MainActor func apply() {
        switch self {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }
}

struct AppearanceMenu: View {
    @AppStorage(AppearanceMode.key) private var mode: AppearanceMode = .system

    var body: some View {
        Picker("Appearance", selection: $mode) {
            ForEach(AppearanceMode.allCases) { Text($0.title).tag($0) }
        }

        Button("Toggle Light/Dark") {
            let isDark = NSApp.effectiveAppearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            mode = isDark ? .light : .dark
        }
        .keyboardShortcut("l", modifiers: [.command, .shift])
    }
}
