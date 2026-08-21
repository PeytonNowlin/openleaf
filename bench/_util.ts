/** Shared benchmark helpers. Not shipped -- this directory is a measurement rig. */

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? (s[m] as number) : (((s[m - 1] as number) + (s[m] as number)) / 2)
}

/** Median wall-clock of `runs` timed iterations after `warmup` untimed ones. */
export function time(label: string, fn: () => void, runs = 15, warmup = 3): number {
  for (let i = 0; i < warmup; i += 1) fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t0 = performance.now()
    fn()
    samples.push(performance.now() - t0)
  }
  const ms = median(samples)
  console.log(`${label.padEnd(60)} ${ms.toFixed(3)} ms`)
  return ms
}
