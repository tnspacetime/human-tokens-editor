import QuartzCore
import SwiftUI

/// Animates a height frame by frame.
///
/// SwiftUI doesn't animate the size of the AppKit views it hosts (the web
/// views, the text view); they jump to the new size. Changing the height a
/// little on every frame makes SwiftUI lay them out every frame instead, so
/// the sheet glides.
@MainActor
@Observable
final class HeightAnimator {
    private(set) var value: CGFloat = 0

    @ObservationIgnored private var from: CGFloat = 0
    @ObservationIgnored private var target: CGFloat = 0
    @ObservationIgnored private var startTime: CFTimeInterval = 0
    @ObservationIgnored private var duration: CFTimeInterval = 0.3
    @ObservationIgnored private var timer: Timer?

    /// Moves to `height`, gliding if `animated`, otherwise immediately
    /// (while a finger is on the handle, or for small continuous changes).
    func move(to height: CGFloat, animated: Bool, duration: CFTimeInterval = 0.3) {
        guard animated else {
            stop()
            target = height
            if value != height { value = height }
            return
        }
        guard abs(height - target) > 0.5 || (timer == nil && abs(height - value) > 0.5) else { return }
        from = value
        target = height
        startTime = CACurrentMediaTime()
        self.duration = duration
        if timer == nil {
            let timer = Timer(timeInterval: 1.0 / 120, repeats: true) { [weak self] timer in
                // The window closed mid-glide: nothing left to move.
                guard self != nil else { return timer.invalidate() }
                MainActor.assumeIsolated { self?.step() }
            }
            // .common so it keeps running while you scroll or drag.
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        }
    }

    private func step() {
        let t = min(1, (CACurrentMediaTime() - startTime) / duration)
        let eased = 1 - pow(1 - t, 3) // ease out
        value = from + (target - from) * eased
        if t >= 1 { stop() }
    }

    private func stop() {
        timer?.invalidate()
        timer = nil
    }
}
