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

  // DOC (old Word) — try to extract as UTF-8 text; Claude vision can't read binary .doc
  if (ext === 'doc' || mimeType === 'application/msword') {
    const text = buf.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, '\n').trim()
    return text.length > 100 ? text : 'Could not extract text from .doc file. Please save as .docx or PDF.'
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
    if (text.length > 50) return text
    // Scanned PDF with no selectable text — use Claude document vision
    return extractPdfWithClaude(buf)
  } catch {
    return extractPdfWithClaude(buf)
  }
}

async function extractPdfWithClaude(buf: Buffer): Promise<string> {
  const base64 = buf.toString('base64')
  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 2000,
    messages: [{
      role:    'user',
      content: [{
        type:   'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64 },
      } as unknown as Anthropic.TextBlockParam, {
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
