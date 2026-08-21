/**
 * Deep immutability for the shared policy data.
 *
 * Every allowlist in this project is a module-level singleton that consumers
 * read by default rather than pass around. That is the right shape -- one
 * answer per question, as this package's whole premise -- but it means an
 * unfrozen list is a process-wide switch that any code on the page can flip:
 * `EMBED_HOSTS.push({ host: 'evil.example' })` or
 * `DEFAULT_POLICY.globalAttributes.push('onclick')` reconfigures every
 * subsequent check, with no call site changed and nothing to notice in review.
 *
 * `readonly` in the type does not help here. It is erased at build time, so it
 * stops a TypeScript consumer and no one else -- not a JavaScript consumer, not
 * a cast, and not the compromised transitive dependency that is the reason to
 * care. Freezing makes the same attempt a `TypeError` at the line that tried it.
 */

/**
 * Freeze `value` and everything reachable from it.
 *
 * `RegExp` is left alone deliberately. Freezing one is not useful -- the
 * interesting state is `lastIndex`, which is an own property the engine writes
 * during `exec`/`test` on `/g` and `/y` patterns, so freezing a regex risks
 * turning a working match into a `TypeError` for no security gain. The patterns
 * this guards are path matchers whose source is already immutable.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (value instanceof RegExp) return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}
