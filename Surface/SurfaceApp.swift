import SwiftUI

@main
struct SurfaceApp: App {
    var body: some Scene {
        // DocumentGroup gives New / Open / Save / Revert / Recents, autosave,
        // and opening files dropped on the Dock icon, all for free.
        DocumentGroup(newDocument: MarkdownDocument()) { file in
            EditorWindow(document: file.$document)
        }
    }
}
