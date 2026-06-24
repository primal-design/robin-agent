import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── Extract text from uploaded CV file ───────────────────────────────────────

export async function extractTextFromFile(
  buf:      Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  // PDF
  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return extractPdf(buf)
  }

  // DOCX
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return extractDocx(buf)
  }

  // DOC (old Word) — use Claude vision as fallback
  if (ext === 'doc' || mimeType === 'application/msword') {
    return extractWithClaude(buf, 'image/jpeg')
  }

  // Images — use Claude vision
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ||
      mimeType.startsWith('image/')) {
    const imgMime = mimeType.startsWith('image/') ? mimeType : `image/${ext}` as 'image/jpeg'
    return extractWithClaude(buf, imgMime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp')
  }

  // Plain text fallback
  return buf.toString('utf-8')
}

// ── PDF extraction ────────────────────────────────────────────────────────────

async function extractPdf(buf: Buffer): Promise<string> {
  try {
    // @ts-ignore — pdf-parse has no types
    const pdfParse = (await import('pdf-parse')).default
    const data = await pdfParse(buf)
    const text = data.text?.trim() ?? ''
    if (text.length > 100) return text
    // If PDF text extraction gave too little (scanned PDF), fall back to Claude vision
    return extractWithClaude(buf, 'application/pdf' as 'image/jpeg')
  } catch {
    // Scanned PDF — use Claude vision
    return extractWithClaude(buf, 'application/pdf' as 'image/jpeg')
  }
}

// ── DOCX extraction ───────────────────────────────────────────────────────────

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result  = await mammoth.extractRawText({ buffer: buf })
  return result.value?.trim() ?? ''
}

// ── Claude vision extraction (images + scanned PDFs) ─────────────────────────

async function extractWithClaude(
  buf:      Buffer,
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf'
): Promise<string> {
  const base64 = buf.toString('base64')

  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 2000,
    messages: [{
      role:    'user',
      content: [{
        type:   'image',
        source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: base64 },
      }, {
        type: 'text',
        text: 'This is a CV/resume. Extract all the text content exactly as written. Return only the extracted text, no commentary.',
      }],
    }],
  })

  return res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()
}
