# Surface

A minimal markdown editor for macOS. You write in plain, native source text.
A sheet at the top of the window shows the text rendered.

- **Scroll under**: text you scroll past slides under the sheet and appears there rendered. Drag the sheet's handle down for more, or all the way for a full preview.
- **Current paragraph**: the sheet renders the block your cursor is in (good for math, tables and code).

Files are plain `.md` on disk. Series, typewriter mode and publishing come later.

## Run it

Open `Surface.xcodeproj` in Xcode and press ⌘R, or from a terminal:

```bash
xcodebuild -project Surface.xcodeproj -scheme Surface -derivedDataPath build/DerivedData build
open build/DerivedData/Build/Products/Debug/Surface.app docs/Welcome.md
```

| Action | How |
| --- | --- |
| New / open / save | ⌘N / ⌘O / ⌘S (autosave and versions are on) |
| Open by dragging | Drop a `.md` file on the window or the Dock icon |
| Show/hide sheet | ⌘\ or the toolbar button |
| Switch sheet mode | Toolbar segmented control |
| Jump to source | Click a rendered block in the sheet |

## How it fits together

```
SwiftUI window (EditorWindow)
 ├─ SheetView ─ WKWebView ─ renderer.html  (markdown-it + KaTeX + highlight.js)
 ├─ SheetHandle (drag to resize)
 └─ SourceEditor ─ SurfaceTextView (NSTextView, TextKit 2) + MarkdownHighlighter
PreviewBridge: Swift → JS calls (setDocument, scrollToLine, focusLine, setMode)
               JS → Swift messages (jump to a block's source line)
```

Swift owns the text and the files. The web view only renders. The renderer
splits the document into top-level blocks and tags each one with the source
lines it came from, which is how the editor's scroll position and cursor line
map onto the sheet.

| Path | What |
| --- | --- |
| `Surface/` | The app (an Xcode synchronized folder: new files are picked up automatically) |
| `web/` | Renderer source. `cd web && npm install && npm run build` regenerates `Surface/renderer.html` |
| `docs/Welcome.md` | Sample document covering every feature |

`Surface/renderer.html` is generated but committed, so building the app doesn't need Node.

## Licenses of dependencies

All MIT, BSD or similar: markdown-it (MIT), KaTeX (MIT), highlight.js (BSD-3-Clause), esbuild (MIT, build only).
