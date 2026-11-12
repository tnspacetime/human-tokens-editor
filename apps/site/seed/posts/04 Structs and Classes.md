# Structs and Classes

Both group data and behaviour. The difference is how they're **copied**.

## Structs are values

```swift
struct Point {
    var x: Double
    var y: Double
}

var a = Point(x: 0, y: 0)
var b = a       // a copy
b.x = 10        // a.x is still 0
```

## Classes are references

```swift
final class Box {
    var value = 0
}

let first = Box()
let second = first   // the same box
second.value = 5     // first.value is now 5 too
```

## Which to use?

- Start with a **struct**.
- Reach for a **class** when you need shared, mutable identity.

The distance between two points is

$$
d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}
$$
