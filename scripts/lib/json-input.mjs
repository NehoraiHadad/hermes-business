/** Parse a JSON document, including a final report emitted after progress lines. */
export function parseJsonInput(value) {
  const text = String(value).replace(/^\uFEFF/, '').trim()
  try {
    return JSON.parse(text)
  } catch (originalError) {
    const lines = text.split(/\r?\n/)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index].trimStart().startsWith('{')) continue
      try {
        return JSON.parse(lines.slice(index).join('\n'))
      } catch {
        // Keep scanning for the first line of the final complete JSON report.
      }
    }
    throw originalError
  }
}
