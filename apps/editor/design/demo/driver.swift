// Drives a debug build of Fold MD through the demo, using the app's own
// debug hooks (distributed notifications, see testHooks in EditorWindow.swift).
//
//   driver prepare <Basel.md> <working copy>   the document without the typed part
//   driver setup <Basel.md>                    place the window and the cursor
//   driver play <Basel.md>                     the performance itself
import AppKit

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: driver prepare|setup|play <Basel.md> [out]"); exit(1) }
let final = try! String(contentsOfFile: args[2], encoding: .utf8) as NSString

// The typed part: the Basel sum's block and the paragraph after it.
let typedStart = final.range(of: "$$\n\\sum").location
let typedEnd = NSMaxRange(final.range(of: "like one:\n\n"))
let typed = final.substring(with: NSRange(location: typedStart, length: typedEnd - typedStart)) as NSString
let formula = typed.substring(with: NSRange(location: 3, length: typed.range(of: "\n$$").location - 3))
let paragraph = typed.substring(from: NSMaxRange(typed.range(of: "\n$$\n\n"))).trimmingCharacters(in: .newlines)

func offset(of s: String) -> Int {
    let r = final.range(of: s)
    precondition(r.location != NSNotFound, "not in the document: \(s)")
    return r.location
}

if args[1] == "prepare" {
    let copy = final.substring(to: typedStart) + final.substring(from: typedEnd)
    try! copy.write(toFile: args[3], atomically: true, encoding: .utf8)
    exit(0)
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

/// Types like a person: quick within words, a beat after punctuation,
/// a little slower through LaTeX.
func type(_ text: String, speed: Double = 1) {
    var previous: Character = " "
    for ch in text {
        post("testType", "\(pid),\(ch)")
        var delay = Double.random(in: 0.028...0.06)
        if ch == " " { delay += Double.random(in: 0...0.03) }
        if ".,;:".contains(ch) { delay += 0.12 }
        if ch == "\n" { delay += 0.12 }
        if ch == "\\" || ch == "{" || (previous == "\\") { delay += 0.015 }
        previous = ch
        wait(delay / speed)
    }
}

let insert = typedStart

// The window, in AppKit points on the built-in display (1728 x 1117). The
// recording keeps the band from y 94 to 1066; the window sits in its middle.
// With the page out (760 wide, set by record.sh) it's 880 + 761 wide, so it
// first glides left to where the whole thing ends up centred.
let writingWidth = 880, frameHeight = 890, frameY = 135
let centredX = (1728 - writingWidth) / 2
let openX = (1728 - (writingWidth + 761)) / 2

switch args[1] {
case "setup":
    // Centred on the built-in display, in the band the recording keeps.
    post("frame", "\(centredX),\(frameY),\(writingWidth),\(frameHeight)")
    wait(0.4)
    post("caret", "\(insert)")

case "play":
    wait(1.6)

    // 1. Write the Basel sum: open and close the block, then fill it in.
    // Quickly: until both fences are there, the highlighter pairs the open
    // one with the next block's and restyles everything below.
    type("$$\n\n$$\n\n", speed: 6)
    post("caret", "\(insert + 3)")
    wait(0.25)
    type(formula, speed: 1.6)
    wait(0.3)
    post("caret", "\(insert + 3 + (formula as NSString).length + 3)")
    wait(0.2)
    type("\n\n" + paragraph, speed: 1.5)
    wait(1.4)

    // 2. Scroll down: everything you pass goes under the sheet, rendered.
    post("glide", "850,4.5")
    wait(5.2)

    // 3. Current paragraph: the sheet renders the block you're in.
    post("mode", "focus"); wait(0.6)
    for target in ["from math import pi", "\\zeta(s) = \\sum", "fn gcd(mut a", "| 3 | 1.202057"] {
        post("caret", "\(offset(of: target))")
        wait(1.6)
    }

    // 4. Pull the sheet down for a full preview, then push it back.
    post("mode", "under"); wait(0.5)
    post("pull"); wait(0.5)
    post("pull"); wait(1.8)
    post("push"); wait(0.6)
    post("sheetLimit", "330"); wait(0.8)

    // 5. A note to yourself, in the margin, never published.
    post("glide", "-4000,1.4"); wait(1.8)
    let phrase = "a question that had beaten the Bernoullis for half a century"
    post("select", "\(offset(of: phrase)),\((phrase as NSString).length)"); wait(1.0)
    post("testAddNote", "\(pid),\(offset(of: phrase)),\((phrase as NSString).length)"); wait(0.5)
    type("Jakob or Johann? Check before publishing.", speed: 1.5)
    wait(0.8)
    post("testWrite", "\(pid),-1")
    post("caret", "\(offset(of: "The answer had no business"))"); wait(1.2)

    // 6. The publishing surface: the page as it will be published.
    post("frame", "\(openX),\(frameY),\(writingWidth),\(frameHeight),1"); wait(0.7)
    post("togglePage"); wait(2.4)
    post("glide", "700,3"); wait(3.4)

    // 7. And in the dark.
    post("appearance", "dark"); wait(2.6)

default:
    print("unknown command \(args[1])"); exit(1)
}
