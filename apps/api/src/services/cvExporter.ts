import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, Table, TableRow, TableCell,
  WidthType, ShadingType, convertInchesToTwip,
} from 'docx'

export interface CvExportInput {
  cvContent:   string  // markdown/text from resumes table
  fullName:    string
  email?:      string
  phone?:      string
  location?:   string
}

// ── Parse plain text / light markdown CV into structured sections ─────────────
function parseSections(text: string): Array<{ heading: string; lines: string[] }> {
  const sections: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()

    // Detect headings: lines in ALL CAPS, or starting with ## / #
    const isHeading =
      /^#{1,3}\s/.test(line) ||
      (line.length > 2 && line === line.toUpperCase() && /[A-Z]{3}/.test(line)) ||
      /^[A-Z][A-Z\s\/&]{4,}$/.test(line.trim())

    if (isHeading) {
      if (current) sections.push(current)
      current = { heading: line.replace(/^#{1,3}\s*/, '').trim(), lines: [] }
    } else if (current) {
      current.lines.push(line)
    } else {
      // Lines before first heading — treat as header/contact block
      if (!current) current = { heading: '__HEADER__', lines: [] }
      current.lines.push(line)
    }
  }
  if (current) sections.push(current)
  return sections
}

function hr(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'B8976B', space: 4 } },
    spacing: { before: 40, after: 40 },
  })
}

function heading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 22, color: '8B6E4A', font: 'Calibri' })],
    spacing: { before: 280, after: 80 },
  })
}

function bodyLine(text: string, opts: { bold?: boolean; italic?: boolean; size?: number } = {}): Paragraph {
  const clean = text.replace(/^\s*[-•*]\s*/, '').trim()
  if (!clean) return new Paragraph({ spacing: { after: 40 } })
  const isBullet = /^\s*[-•*]/.test(text)
  return new Paragraph({
    children: [new TextRun({
      text: clean,
      bold:   opts.bold   ?? false,
      italics: opts.italic ?? false,
      size:   (opts.size  ?? 22),
      font:   'Calibri',
    })],
    bullet: isBullet ? { level: 0 } : undefined,
    spacing: { after: 60 },
  })
}

// ── Build the .docx buffer ────────────────────────────────────────────────────
export async function buildCvDocx(input: CvExportInput): Promise<Buffer> {
  const children: Paragraph[] = []

  // ── Name header ──
  children.push(new Paragraph({
    children: [new TextRun({ text: input.fullName, bold: true, size: 52, font: 'Calibri', color: '1A1816' })],
    alignment: AlignmentType.LEFT,
    spacing: { after: 80 },
  }))

  // ── Contact line ──
  const contact = [input.email, input.phone, input.location].filter(Boolean).join('  ·  ')
  if (contact) {
    children.push(new Paragraph({
      children: [new TextRun({ text: contact, size: 20, color: '6B6460', font: 'Calibri' })],
      spacing: { after: 40 },
    }))
  }
  children.push(hr())

  // ── Sections from parsed CV ──
  const sections = parseSections(input.cvContent)
  for (const sec of sections) {
    if (sec.heading === '__HEADER__') {
      // Skip — already rendered name/contact above
      continue
    }
    children.push(heading(sec.heading))

    for (const line of sec.lines) {
      if (!line.trim()) { children.push(new Paragraph({ spacing: { after: 60 } })); continue }

      // Bold lines (role titles / company names) — heuristic: short lines before a date
      const looksLikeTitle = /^\s*[A-Z][^a-z]{0,60}$/.test(line) || /\d{4}\s*[-–]\s*(\d{4}|present)/i.test(line)
      children.push(bodyLine(line, { bold: looksLikeTitle }))
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertInchesToTwip(0.75),
            bottom: convertInchesToTwip(0.75),
            left:   convertInchesToTwip(0.85),
            right:  convertInchesToTwip(0.85),
          },
        },
      },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
