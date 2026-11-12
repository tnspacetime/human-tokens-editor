# Closures, Explained

A **closure** is a block of code you can pass around, like a value. It *captures* the variables around it.

```swift
let numbers = [3, 1, 2]
let sorted = numbers.sorted { $0 < $1 }
// [1, 2, 3]
```

## Capturing values

```swift
func makeCounter() -> () -> Int {
    var count = 0
    return {
        count += 1
        return count
    }
}

let next = makeCounter()
next() // 1
next() // 2
```

The closure keeps `count` alive even after `makeCounter` returns.

## Trailing closures

When a closure is the last argument, it can go outside the parentheses:

1. `numbers.map({ $0 * 2 })`
2. `numbers.map { $0 * 2 }`

Both mean the same thing; the second reads better.
