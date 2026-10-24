export function encodeCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map((row) => row.map((value) => {
    // Prevent spreadsheet formulas when opening exported data.
    const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
}

export function parseResidentCsv(text: string, expectedHeaders: readonly string[], includeRowNumbers = false, optionalHeaders: readonly string[] = []): Record<string, string>[] {
  if (text.length > 2_000_000) throw new Error('CSV must be smaller than 2 MB')
  const records: string[][] = []
  const rowLines: number[] = []
  let line = 1, rowLine = 1
  let row: string[] = [], field = '', quoted = false, closed = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else { quoted = false; closed = true }
      } else { field += char; if (char === '\n') line++ }
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false
      if (char !== ',') {
        if (row.some((value) => value.trim())) { records.push(row); rowLines.push(rowLine) }
        row = []
        if (char === '\r' && text[i + 1] === '\n') i++
        line++; rowLine = line
      }
    } else if (char === '"' && !field && !closed) quoted = true
    else {
      if (closed || char === '"') throw new Error('Invalid CSV quoting. Export the file as CSV and try again.')
      field += char
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quote')
  row.push(field)
  if (row.some((value) => value.trim())) { records.push(row); rowLines.push(rowLine) }
  const headers = records.shift()?.map((value) => value.trim()) ?? []
  rowLines.shift()
  if (new Set(headers).size !== headers.length || headers.some((header) => !expectedHeaders.includes(header)) || expectedHeaders.some((header) => !optionalHeaders.includes(header) && !headers.includes(header))) throw new Error('Use the downloaded template with its original column headers')
  if (!records.length || records.length > 2000) throw new Error('Upload between 1 and 2000 flat rows')
  return records.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${rowLines[index]} has the wrong number of columns`)
    const result = Object.fromEntries(headers.map((header, column) => {
      let value = values[column]!.trim()
      if (/^'[=+@\-\t\r]/.test(value)) value = value.slice(1)
      return [header, value]
    }))
    if (includeRowNumbers) result.__row = String(rowLines[index])
    return result
  })
}

export function downloadCsv(name: string, rows: string[][]) {
  const url = URL.createObjectURL(new globalThis.Blob([encodeCsv(rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  URL.revokeObjectURL(url)
}
