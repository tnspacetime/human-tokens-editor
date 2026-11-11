# Fold<sup>md</sup>

A minimal markdown editor for macOS. You write in plain, native source text.
A sheet folds down from the top to show it rendered, and the publishing
surface folds out to the right to show the page as it will be published.

- **Scroll under**: text you scroll past slides under the sheet and appears there rendered. Drag the sheet's handle down for more, or all the way for a full preview. While you type, the paragraph you're writing stays just below the sheet (typewriter scrolling).
- **Current paragraph**: the sheet renders the block your cursor is in (good for math, tables and code).
- **Publishing surface**: the window grows to the right and the published page slides out beside your writing, then slides back in.

Files are plain `.md` on disk. Series and publishing come next.

## Run it

Open `FoldMD.xcodeproj` in Xcode and press ⌘R, or from a terminal:

```bash
xcodebuild -project FoldMD.xcodeproj -scheme FoldMD -derivedDataPath build/DerivedData build
open "build/DerivedData/Build/Products/Debug/Fold MD.app" docs/Welcome.md
```

| Action | How |
| --- | --- |
| New / open / save | ⌘N / ⌘O / ⌘S (autosave and versions are on) |
| Open by dragging | Drop a `.md` file on the window or the Dock icon |
| Show/hide sheet | ⌘\ or the toolbar button |
| Switch sheet mode | Toolbar segmented control |
| Publishing surface | ⌥⌘P or the toolbar button |
| Light / dark | Toolbar sun/moon (hold for System), ⇧⌘L, or View ▸ Appearance |
| Typewriter scrolling | View ▸ Typewriter Scrolling (⌥⌘T) |
| Jump to source | Click a rendered block in the sheet or the page |

## How it fits together

```
SwiftUI window (EditorWindow)
 ├─ writing surface
 │   ├─ sheet: PreviewView ─ WKWebView ─ renderer.html  (markdown-it + KaTeX + highlight.js)
 │   ├─ SheetHandle (drag to resize)
 │   └─ SourceEditor ─ FoldTextView (NSTextView, TextKit 1) + MarkdownHighlighter
 └─ publishing surface: PageSurface ─ WKWebView ─ renderer.html (page mode)
PreviewBridge (one per preview): Swift → JS calls (setDocument, scrollToLine, focusLine, setMode, setAnchor)
                                 JS → Swift messages (jump to a block's source line)
```

Swift owns the text and the files. The web views only render. The renderer
splits the document into top-level blocks and tags each one with the source
lines it came from, which is how the editor's scroll position and cursor line
map onto the sheet and the page.

| Path | What |
| --- | --- |
| `FoldMD/` | The app (an Xcode synchronized folder: new files are picked up automatically) |
| `web/` | Renderer source. `cd web && npm install && npm run build` regenerates `FoldMD/renderer.html` |
| `design/` | Icon source: `swift design/icon.swift` redraws `FoldMD/Assets.xcassets/AppIcon.appiconset` |
| `docs/Welcome.md` | Sample document covering every feature |

`FoldMD/renderer.html` is generated but committed, so building the app doesn't need Node.

## Licenses of dependencies

All MIT, BSD or similar: markdown-it (MIT), KaTeX (MIT), highlight.js (BSD-3-Clause), esbuild (MIT, build only).
