# Values and Types

Swift is *type-safe*: every value has a type, and the compiler checks that you use it correctly.

## Constants and variables

```swift
let name = "Ada"        // a constant: can't change
var count = 0           // a variable: can change
count += 1
```

Prefer `let`. Use `var` only when a value really needs to change.

## Common types

| Type | Example | Notes |
| --- | --- | --- |
| `Int` | `42` | Whole numbers |
| `Double` | `3.14` | Decimal numbers |
| `String` | `"hello"` | Text |
| `Bool` | `true` | Yes or no |

## A little math

The area of a circle is $A = \pi r^2$. In Swift:

```swift
let radius = 2.0
let area = Double.pi * radius * radius
```
