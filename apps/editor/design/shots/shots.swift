// Sets up a debug build of Fold MD for each screenshot, using the app's own
// debug hooks (distributed notifications, see testHooks in EditorWindow.swift).
// shoot.sh takes the picture after each step.
//
//   shots <step> <Basel.md> [object]
//
// Steps, in shoot.sh's order: setup, under, maths, focus, notes, page, dark,
// publish <command>, series <folder|Title>.
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: shots <step> <Basel.md> [object]"); exit(1) }
let document = try! String(contentsOfFile: args[2], encoding: .utf8) as NSString
let object = args.count > 3 ? args[3] : ""

func offset(of s: String) -> Int {
    let r = document.range(of: s)
    precondition(r.location != NSNotFound, "not in the document: \(s)")
    return r.location
}

guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "md.fold.app").first else {
    print("Fold MD isn't running"); exit(1)
}
let pid = app.processIdentifier

func post(_ name: String, _ object: String? = nil) {
    DistributedNotificationCenter.default().postNotificationName(
        .init("md.fold.app." + name), object: object, userInfo: nil, deliverImmediately: true)
}
func wait(_ seconds: Double) { Thread.sleep(forTimeInterval: seconds) }

/// Types like a person, quickly (the notes' text).
func type(_ text: String) {
    for ch in text {
        post("testType", "\(pid),\(ch)")
        wait(0.02)
    }
}

// The window, as in the demo (design/demo/driver.swift): in AppKit points on
// the built-in display, in the band the pictures keep (y 51 to 1023 from the
// top). With the page out it's 880 + 761 wide, centred.
let writingWidth = 880, frameHeight = 890, frameY = 135
let centredX = (1728 - writingWidth) / 2
let openX = (1728 - (writingWidth + 761)) / 2

switch args[1] {
case "setup":
    // Out of the pictures: the pointer goes up into the menu bar.
    CGWarpMouseCursorPosition(CGPoint(x: 864, y: 12))
    post("frame", "\(centredX),\(frameY),\(writingWidth),\(frameHeight)")
    wait(0.4)
    post("caret", "0")

case "under":
    // Scroll-under: what you've scrolled past is under the sheet, set.
    post("glide", "850,0.5"); wait(0.9)
    post("caret", "\(offset(of: "Now compare"))"); wait(0.4)

case "maths":
    // The writing alone, sheet away: maths and code coloured as you write them.
    post("toggleSheet"); wait(0.8)
    post("glide", "-4000,0.3"); wait(0.6)
    post("caret", "\(offset(of: "The answer had no business"))"); wait(0.4)

case "focus":
    // Current paragraph: the sheet sets the block the cursor is in.
    post("toggleSheet"); wait(0.8)
    post("mode", "focus"); wait(0.5)
    post("caret", "\(offset(of: "\\zeta(s) = \\sum"))"); wait(1.2)

case "notes":
    // A note to yourself in the margin, never published.
    post("mode", "under"); wait(0.4)
    post("glide", "-4000,0.4"); wait(0.8)
    let phrase = "a question that had beaten the Bernoullis for half a century"
    post("select", "\(offset(of: phrase)),\((phrase as NSString).length)"); wait(0.6)
    post("testAddNote", "\(pid),\(offset(of: phrase)),\((phrase as NSString).length)"); wait(0.5)
    type("Jakob or Johann? Check before publishing.")
    wait(0.5)
    post("testWrite", "\(pid),-1")
    post("caret", "\(offset(of: "The answer had no business"))"); wait(0.8)

case "page":
    // The page as it will be published, folded out beside the writing.
    post("frame", "\(openX),\(frameY),\(writingWidth),\(frameHeight),1"); wait(0.7)
    post("togglePage"); wait(2.2)
    post("glide", "620,0.6"); wait(1.6)

case "dark":
    post("appearance", "dark"); wait(2.0)

case "light":
    post("appearance", "light"); wait(1.6)

case "publish":
    // A publishing command for this document ("start", "author Name,handle",
    // "pledge", "cancel", "disconnect"): see the publish hook.
    post("publish", "\((args[2] as NSString).lastPathComponent)|\(object)")

case "series":
    // The page goes back in, then a series of three parts opens in the
    // sidebar ("folder|Title").
    post("togglePage"); wait(1.2)
    post("frame", "\(centredX),\(frameY),\(writingWidth),\(frameHeight)"); wait(0.6)
    post("seriesDemo", object); wait(2.5)
    post("toggleSidebar"); wait(1.6)

case "seriesEnd":
    post("seriesDemoEnd", object); wait(1.0)

default:
    print("unknown step \(args[1])"); exit(1)
}
