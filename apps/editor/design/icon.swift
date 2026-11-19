// Draws the Fold MD app icon and writes the asset catalog.
//
//   swift design/icon.swift
//
// A white tile with a few warm lines of text. The top half is a sheet of
// frosted glass folded down over them, the way the app's sheet folds down
// over your writing: below the glass the lines are crisp, under it they glow.
// "md" sits on the glass, in ink.

import AppKit
import CoreImage

let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let catalog = root.appending(path: "FoldMD/Assets.xcassets")
let iconSet = catalog.appending(path: "AppIcon.appiconset")

// MARK: Palette

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

let backgroundTop = rgb(0xFFFFFF)
let backgroundBottom = rgb(0xF0F0F3)
let lineStart = rgb(0xF8A21C)
let lineEnd = rgb(0xEC5E12)
let ink = rgb(0x1D1D1F)

// MARK: Geometry (1024 canvas, top-left origin)

let canvas: CGFloat = 1024
let body = CGRect(x: 100, y: 100, width: 824, height: 824) // the macOS icon grid
let glassBottom: CGFloat = 540                              // where the fold ends

/// The macOS icon shape: a superellipse, close to Apple's continuous squircle.
func squircle(in rect: CGRect, exponent n: CGFloat = 4.1) -> CGPath {
    let path = CGMutablePath()
    let a = rect.width / 2, b = rect.height / 2
    for i in 0...720 {
        let t = CGFloat(i) / 720 * 2 * .pi
        let c = cos(t), s = sin(t)
        let point = CGPoint(x: rect.midX + a * (c < 0 ? -1 : 1) * pow(abs(c), 2 / n),
                            y: rect.midY + b * (s < 0 ? -1 : 1) * pow(abs(s), 2 / n))
        if i == 0 { path.move(to: point) } else { path.addLine(to: point) }
    }
    path.closeSubpath()
    return path
}

let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

func gradient(_ colors: [CGColor], _ locations: [CGFloat]? = nil) -> CGGradient {
    CGGradient(colorsSpace: sRGB, colors: colors as CFArray, locations: locations)!
}

// MARK: Drawing

/// Core Graphics shadows are in device pixels with y pointing up, whatever the
/// current transform. This takes canvas units with y pointing down.
var unit: CGFloat = 1
func shadow(_ cg: CGContext, dy: CGFloat, blur: CGFloat, alpha: CGFloat) {
    cg.setShadow(offset: CGSize(width: 0, height: -dy * unit), blur: blur * unit, color: rgb(0x000000, alpha))
}

/// The lines of text: rounded bars with a warm horizontal gradient.
func drawLines(_ cg: CGContext, detailed: Bool) {
    let rows: [(y: CGFloat, width: CGFloat)] = detailed
        ? [(250, 0.70), (350, 0.88), (450, 0.56), (586, 0.80), (686, 0.62), (786, 0.40)]
        : [(260, 0.70), (420, 0.56), (600, 0.80), (760, 0.50)]
    let height: CGFloat = detailed ? 52 : 80
    let left: CGFloat = 214, full: CGFloat = 596
    for row in rows {
        let rect = CGRect(x: left, y: row.y, width: full * row.width, height: height)
        cg.saveGState()
        cg.addPath(CGPath(roundedRect: rect, cornerWidth: height / 2, cornerHeight: height / 2, transform: nil))
        cg.clip()
        cg.drawLinearGradient(gradient([lineStart, lineEnd]), start: CGPoint(x: left, y: 0),
                              end: CGPoint(x: left + full, y: 0), options: [.drawsAfterEndLocation])
        cg.restoreGState()
    }
}

/// Renders a layer into its own image (same size and transform as the icon).
func layer(pixels: Int, _ draw: (CGContext) -> Void) -> CGImage {
    let cg = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
                       space: sRGB, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    cg.translateBy(x: 0, y: CGFloat(pixels))
    cg.scaleBy(x: CGFloat(pixels) / canvas, y: -CGFloat(pixels) / canvas)
    draw(cg)
    return cg.makeImage()!
}

func blurred(_ image: CGImage, radius: CGFloat) -> CGImage {
    let input = CIImage(cgImage: image)
    let output = input.clampedToExtent()
        .applyingGaussianBlur(sigma: radius)
        .cropped(to: input.extent)
    return CIContext().createCGImage(output, from: input.extent)!
}

/// Draws an image that was rendered with `layer` back onto the icon.
func place(_ cg: CGContext, _ image: CGImage) {
    cg.saveGState()
    // Undo the flip for CGImage drawing.
    cg.translateBy(x: 0, y: canvas)
    cg.scaleBy(x: 1, y: -1)
    cg.draw(image, in: CGRect(x: 0, y: 0, width: canvas, height: canvas))
    cg.restoreGState()
}

func draw(_ cg: CGContext, pixels: Int) {
    unit = CGFloat(pixels) / canvas
    let detailed = pixels >= 64
    let shape = squircle(in: body)
    let glassRect = CGRect(x: 0, y: 0, width: canvas, height: glassBottom)

    // 1. The white tile, with the soft drop shadow of the macOS grid.
    cg.saveGState()
    shadow(cg, dy: 10, blur: 24, alpha: 0.22)
    cg.addPath(shape)
    cg.setFillColor(backgroundBottom)
    cg.fillPath()
    cg.restoreGState()
    cg.saveGState()
    cg.addPath(shape)
    cg.clip()
    cg.drawLinearGradient(gradient([backgroundTop, backgroundBottom]), start: CGPoint(x: 0, y: body.minY),
                          end: CGPoint(x: 0, y: body.maxY), options: [])

    // 2. The lines, crisp. (The glass will cover the top ones.)
    let lines = layer(pixels: pixels) { drawLines($0, detailed: detailed) }
    place(cg, lines)

    // 3. The glass casts a shadow onto what's below its edge.
    cg.saveGState()
    shadow(cg, dy: 12, blur: 30, alpha: 0.16)
    cg.setFillColor(backgroundTop)
    cg.fill(glassRect)
    cg.restoreGState()

    // 4. The glass: what's under it, blurred and lifted, with a sheen.
    cg.saveGState()
    cg.clip(to: glassRect)
    cg.setFillColor(backgroundTop)
    cg.fill(glassRect)
    // Frosting: the lines blurred twice over (a wide glow and a closer one),
    // milky white over them, and a sheen brightest at the top.
    place(cg, blurred(lines, radius: 46 * unit))
    place(cg, blurred(lines, radius: 22 * unit))
    cg.setFillColor(rgb(0xFFFFFF, 0.42))
    cg.fill(glassRect)
    cg.drawLinearGradient(gradient([rgb(0xFFFFFF, 0.55), rgb(0xFFFFFF, 0.05), rgb(0xFFFFFF, 0.25)], [0, 0.72, 1]),
                          start: CGPoint(x: 0, y: body.minY), end: CGPoint(x: 0, y: glassBottom), options: [])
    cg.restoreGState()

    // 5. The glass edges: the folded edge, a fine line with light above it.
    cg.setFillColor(rgb(0x000000, 0.10))
    cg.fill(CGRect(x: 0, y: glassBottom - 2, width: canvas, height: 2))
    cg.setFillColor(rgb(0xFFFFFF, 0.9))
    cg.fill(CGRect(x: 0, y: glassBottom - 6, width: canvas, height: 4))
    cg.restoreGState() // end tile clip

    // A fine edge all round, so the white tile holds its shape on a white desktop.
    cg.saveGState()
    cg.addPath(shape)
    cg.clip()
    cg.addPath(squircle(in: body.insetBy(dx: 1, dy: 1)))
    cg.setStrokeColor(rgb(0x000000, 0.08))
    cg.setLineWidth(2)
    cg.strokePath()
    cg.restoreGState()

    // 6. "md" on the glass.
    let font = NSFont.systemFont(ofSize: detailed ? 236 : 300, weight: .bold).withRoundedDesign()
    let md = NSAttributedString(string: "md", attributes: [.font: font, .foregroundColor: NSColor(cgColor: ink)!, .kern: -6])
    let size = md.size()
    let origin = CGPoint(x: (canvas - size.width) / 2, y: body.minY + (glassBottom - body.minY - size.height) / 2 - 6)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: cg, flipped: true)
    cg.saveGState()
    shadow(cg, dy: 3, blur: 10, alpha: 0.10)
    md.draw(at: origin)
    cg.restoreGState()
    NSGraphicsContext.restoreGraphicsState()
}

extension NSFont {
    func withRoundedDesign() -> NSFont {
        guard let descriptor = fontDescriptor.withDesign(.rounded) else { return self }
        return NSFont(descriptor: descriptor, size: pointSize) ?? self
    }
}

func render(pixels: Int) -> Data {
    let image = layer(pixels: pixels) { draw($0, pixels: pixels) }
    return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
}

// MARK: Output

let fm = FileManager.default
try fm.createDirectory(at: iconSet, withIntermediateDirectories: true)
try Data(#"{ "info" : { "author" : "xcode", "version" : 1 } }"#.utf8).write(to: catalog.appending(path: "Contents.json"))

var images: [String] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let pixels = points * scale
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        try render(pixels: pixels).write(to: iconSet.appending(path: name))
        images.append(#"{ "filename" : "\#(name)", "idiom" : "mac", "scale" : "\#(scale)x", "size" : "\#(points)x\#(points)" }"#)
    }
}
let contents = "{\n  \"images\" : [\n    " + images.joined(separator: ",\n    ") + "\n  ],\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}\n"
try Data(contents.utf8).write(to: iconSet.appending(path: "Contents.json"))

try render(pixels: 1024).write(to: root.appending(path: "design/icon-preview.png"))
print("Wrote \(iconSet.path) and design/icon-preview.png")
