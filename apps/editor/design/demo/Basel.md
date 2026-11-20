# The Basel problem

In 1734 a young Leonhard Euler summed the reciprocals of the squares, a question that had beaten the Bernoullis for half a century. The answer had no business being what it is:

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} \;=\; 1 + \frac{1}{4} + \frac{1}{9} + \frac{1}{16} + \cdots \;=\; \frac{\pi^2}{6}
$$

His trick was to treat $\frac{\sin x}{x}$ as a polynomial that vanishes at $x = \pm\pi, \pm 2\pi, \pm 3\pi, \dots$ and factor it like one:

$$
\begin{aligned}
\frac{\sin x}{x} &= 1 - \frac{x^2}{3!} + \frac{x^4}{5!} - \cdots \\
&= \left(1 - \frac{x^2}{\pi^2}\right)\left(1 - \frac{x^2}{4\pi^2}\right)\left(1 - \frac{x^2}{9\pi^2}\right)\cdots
\end{aligned}
$$

Now compare the $x^2$ terms. On the left it is $-\frac{1}{6}$; on the right it is $-\frac{1}{\pi^2}\left(1 + \frac{1}{4} + \frac{1}{9} + \cdots\right)$. Multiply both by $-\pi^2$ and the sum falls out.

## Checking it

A million terms get within a millionth, because the tail after $N$ terms is about $\frac{1}{N}$:

```python
from math import pi

partial = sum(1 / n**2 for n in range(1, 1_000_001))
print(f"{partial:.10f}")    # 1.6449330668
print(f"{pi**2 / 6:.10f}")  # 1.6449340668
```

## Where the primes come in

Every whole number factors into primes in exactly one way, so the same sum is also a product over the primes:

$$
\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^s} = \prod_{p\ \text{prime}} \frac{1}{1 - p^{-s}}
$$

Which gives a strange fact: pick two whole numbers at random, and the chance they share no factor is $\frac{1}{\zeta(2)} = \frac{6}{\pi^2} \approx 0.6079$. Count it:

```rust
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 { (a, b) = (b, a % b); }
    a
}

fn main() {
    let n = 2_000;
    let coprime = (1..=n)
        .flat_map(|a| (1..=n).map(move |b| (a, b)))
        .filter(|&(a, b)| gcd(a, b) == 1)
        .count();
    println!("{:.4}", coprime as f64 / (n * n) as f64); // 0.6083
}
```

| $s$ | $\zeta(s)$ | closed form |
| --- | --- | --- |
| 2 | 1.644934 | $\pi^2/6$ |
| 4 | 1.082323 | $\pi^4/90$ |
| 6 | 1.017343 | $\pi^6/945$ |
| 3 | 1.202057 | none known; irrational (Apéry, 1978) |
