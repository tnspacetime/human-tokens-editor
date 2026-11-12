# Concurrency with async and await

Some work takes time: downloading, reading files, waiting for a server. Swift lets you write that code **in order**, without callbacks.

```swift
func loadProfile() async throws -> Profile {
    let data = try await network.fetch("/profile")
    return try JSONDecoder().decode(Profile.self, from: data)
}
```

## Actors

An `actor` protects its state so only one task touches it at a time:

```swift
actor Counter {
    private var value = 0
    func increment() -> Int {
        value += 1
        return value
    }
}
```

> Data races become compile errors instead of mysterious bugs.

That's the end of the series. Go build something small.
