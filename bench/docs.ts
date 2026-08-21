/** Document generators shared by the benchmarks. */

const WORDS =
  'the quick brown fox jumps over a lazy dog while the editor keeps every byte of inherited markup intact'.split(
    ' ',
  )

function sentence(seed: number, words = 24): string {
  const out: string[] = []
  for (let i = 0; i < words; i += 1) out.push(WORDS[(seed * 7 + i * 13) % WORDS.length] as string)
  return out.join(' ')
}

/** ~30 paragraphs per page, so 100 pages is 3,000 paragraphs. */
export function plainDoc(paragraphs = 3000): string {
  const out: string[] = []
  for (let i = 0; i < paragraphs; i += 1) out.push(`<p>${sentence(i)}</p>`)
  return out.join('')
}

/**
 * What Word actually pastes: a nbsp for most spaces.
 *
 * 3,000 paragraphs x 12 nbsp is ~36,000 nbsp, the figure the audit measured.
 */
export function wordDoc(paragraphs = 3000): string {
  const out: string[] = []
  for (let i = 0; i < paragraphs; i += 1) {
    const words = sentence(i).split(' ')
    // Alternate real space / nbsp, which is what Word's space-runs produce.
    let text = ''
    for (let w = 0; w < words.length; w += 1) {
      if (w > 0) text += w % 2 === 0 ? '&nbsp;' : ' '
      text += words[w]
    }
    out.push(`<p>${text}</p>`)
  }
  return out.join('')
}

export function styledDoc(paragraphs = 3000): string {
  const out: string[] = []
  for (let i = 0; i < paragraphs; i += 1) {
    out.push(
      `<p style="text-align:left;line-height:1.5"><span style="color:#334455">${sentence(i, 12)}</span> <strong>${sentence(i + 1, 6)}</strong></p>`,
    )
  }
  return out.join('')
}

export function tableDoc(tables = 250): string {
  const out: string[] = []
  for (let i = 0; i < tables; i += 1) {
    const rows: string[] = []
    for (let r = 0; r < 4; r += 1) {
      const cells: string[] = []
      for (let c = 0; c < 4; c += 1) cells.push(`<td><p>${sentence(i + r + c, 4)}</p></td>`)
      rows.push(`<tr>${cells.join('')}</tr>`)
    }
    out.push(`<table><tbody>${rows.join('')}</tbody></table><p>${sentence(i, 10)}</p>`)
  }
  return out.join('')
}
