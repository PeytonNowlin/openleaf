import type { MarkType, NodeType } from 'prosemirror-model'
import type { Command, EditorState } from 'prosemirror-state'

export function markIn(state: EditorState, name: string): MarkType | undefined {
  return state.schema.marks[name]
}

export function nodeIn(state: EditorState, name: string): NodeType | undefined {
  return state.schema.nodes[name]
}

export function markCommand(name: string, build: (type: MarkType) => Command): Command {
  return (state, dispatch, view) => {
    const type = markIn(state, name)
    return type ? build(type)(state, dispatch, view) : false
  }
}

export function nodeCommand(name: string, build: (type: NodeType) => Command): Command {
  return (state, dispatch, view) => {
    const type = nodeIn(state, name)
    return type ? build(type)(state, dispatch, view) : false
  }
}

export function canInsertNode(state: EditorState, nodeName: string): boolean {
  const type = nodeIn(state, nodeName)
  if (!type) return false
  const { $from } = state.selection
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const index = $from.index(depth)
    if ($from.node(depth).canReplaceWith(index, index, type)) return true
  }
  return false
}
