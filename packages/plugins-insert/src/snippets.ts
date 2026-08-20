export interface HtmlSnippet {
  id: string
  title: string
  html: string
}

let snippets: readonly HtmlSnippet[] = []

export function registerHtmlSnippets(next: readonly HtmlSnippet[]): void {
  snippets = next
}

export function listedSnippets(): readonly HtmlSnippet[] {
  return snippets
}
