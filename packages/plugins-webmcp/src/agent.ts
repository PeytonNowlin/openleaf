/**
 * The browser's agent tool API, isolated here.
 *
 * This is the only file in the package that names the API, which is the whole
 * argument for the package existing: the surface is young and has already been
 * renamed twice -- an early `window.agent` draft, then a navigator-scoped
 * object, then a document-scoped one -- so the next rename is one file rather
 * than a change to the editor core.
 *
 * The types below are measured, not transcribed. The standards-body proposal
 * still describes a bulk-replace method and no annotations, neither of which
 * matches what ships; a probe against Chrome for Testing 151 with
 * `--enable-blink-features=WebMCP` found:
 *
 *   - `document.modelContext` and `navigator.modelContext`, the same object
 *   - `registerTool`, `getTools`, `executeTool`, `ontoolchange`
 *   - no `unregisterTool`, no bulk replace, no clear
 *   - `registerTool(descriptor, { signal })` returns a promise, and aborting
 *     that signal is the ONLY way a tool goes away. A signal passed inside the
 *     descriptor, or as a bare second argument, is silently ignored
 *   - registering a name that is already taken rejects with
 *     `InvalidStateError: Duplicate tool name`
 *   - `executeTool` returns a string, and hands `execute` the parsed arguments
 */

/** JSON Schema for a tool's arguments. Objects only: every tool takes a bag. */
export interface AgentToolInputSchema {
  type: 'object'
  properties: Record<string, { type: string; description: string }>
  required?: string[]
}

/**
 * What the client driving the agent is told about a call before it makes it.
 *
 * Both hints were confirmed accepted and surfaced back through `getTools()`.
 * `readOnlyHint` is what lets a client decide when to ask a person first;
 * `untrustedContentHint` marks a result that carries document content, because
 * a document is exactly the place where text aimed at the reading agent hides.
 */
export interface AgentToolAnnotations {
  readOnlyHint: boolean
  untrustedContentHint: boolean
}

/**
 * One tool, as a plain value.
 *
 * `execute` returns a string because that is what `executeTool` resolves to --
 * structured results are JSON encoded into it, and every description states the
 * shape. See `result.ts`.
 */
export interface AgentTool {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: AgentToolInputSchema
  readonly annotations: AgentToolAnnotations
  execute(args: Record<string, unknown>): string
}

/** The subset of the browser object this package uses. */
export interface ModelContext {
  registerTool(tool: AgentTool, options?: { signal: AbortSignal }): Promise<void>
}

/**
 * The API object, or `null` in a browser that has none.
 *
 * Document-scoped first: the navigator-scoped copy is deprecated as of Chrome
 * 150 and is the one that will be removed. Both are reached through
 * `globalThis` and both are optional-chained, because this module is imported
 * under bare Node by the SSR-import gate, where `document` does not exist at
 * all -- a bare `document.modelContext` there is a ReferenceError on import,
 * not a clean no-op.
 */
export function resolveModelContext(): ModelContext | null {
  const scope = globalThis as typeof globalThis & {
    document?: { modelContext?: ModelContext }
    navigator?: { modelContext?: ModelContext }
  }
  return scope.document?.modelContext ?? scope.navigator?.modelContext ?? null
}
