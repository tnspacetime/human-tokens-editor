import SwiftUI

@main
struct FoldMDApp: App {
    init() {
        // At launch, open a new empty document ready for typing, rather than
        // the file browser that document apps show by default.
        UserDefaults.standard.register(defaults: ["NSShowAppCentricOpenPanelInsteadOfUntitledFile": false])
    }

    var body: some Scene {
        // DocumentGroup gives New / Open / Save / Revert / Recents, autosave,
        // and opening files dropped on the Dock icon, all for free.
        DocumentGroup(newDocument: MarkdownDocument()) { file in
            EditorWindow(document: file.$document, fileURL: file.fileURL)
        }
        // New windows open compact: one reading column with some margin.
        .defaultSize(width: 760, height: 680)
        .commands {
            CommandGroup(after: .toolbar) {
                TypewriterScrollingToggle()
                Divider()
                AppearanceMenu()
            }
        }
    }
}
