import { google } from 'googleapis'
import { env }    from '../config/env.js'

// Google Drive uses the same OAuth2 client credentials as Gmail (same Google project)
function makeOAuth2(redirectUri?: string) {
  return new google.auth.OAuth2(
    env.gmailClientId,
    env.gmailClientSecret,
    redirectUri
  )
}

export function getGdriveAuthUrl(state: string, redirectUri: string) {
  const auth = makeOAuth2(redirectUri)
  return auth.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    state,
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
  })
}

// Refresh an expired Drive access token using the stored refresh token.
export async function refreshGdriveTokens(
  refreshToken: string,
  redirectUri: string
): Promise<{ access_token: string; expiry_date: number }> {
  const auth = makeOAuth2(redirectUri)
  auth.setCredentials({ refresh_token: refreshToken })
  const { credentials } = await auth.refreshAccessToken()
  return {
    access_token: credentials.access_token ?? '',
    expiry_date:  credentials.expiry_date ?? (Date.now() + 3600 * 1000),
  }
}

export interface DriveFile {
  id:           string
  name:         string
  mimeType:     string
  modifiedTime: string
  webViewLink:  string
  ownerEmail:   string
}

// MIME types we can extract text from
const SUPPORTED_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
])

export async function listDriveFiles(tokens: any, maxResults = 30): Promise<DriveFile[]> {
  const auth = makeOAuth2()
  auth.setCredentials(tokens)
  const drive = google.drive({ version: 'v3', auth })

  const mimeFilter = [...SUPPORTED_MIMES].map(m => `mimeType='${m}'`).join(' or ')
  const r = await drive.files.list({
    pageSize: maxResults,
    q:        `(${mimeFilter}) and trashed=false`,
    orderBy:  'modifiedTime desc',
    fields:   'files(id,name,mimeType,modifiedTime,webViewLink,owners)',
  })
  return (r.data.files ?? []).map((f: any) => ({
    id:           f.id           ?? '',
    name:         f.name         ?? '',
    mimeType:     f.mimeType     ?? '',
    modifiedTime: f.modifiedTime ?? '',
    webViewLink:  f.webViewLink  ?? '',
    ownerEmail:   f.owners?.[0]?.emailAddress ?? '',
  })) as DriveFile[]
}

// Export file content as plain text. Returns empty string on failure.
export async function exportFileContent(tokens: any, file: DriveFile): Promise<string> {
  const auth = makeOAuth2()
  auth.setCredentials(tokens)
  const drive = google.drive({ version: 'v3', auth })

  try {
    if (file.mimeType === 'application/vnd.google-apps.document') {
      const r = await drive.files.export(
        { fileId: file.id, mimeType: 'text/plain' },
        { responseType: 'text' }
      )
      return String(r.data).slice(0, 4000).trim()
    }

    if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      const r = await drive.files.export(
        { fileId: file.id, mimeType: 'text/csv' },
        { responseType: 'text' }
      )
      return String(r.data).slice(0, 2000).trim()
    }

    // text/plain, text/markdown — download directly
    const r = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'text' }
    )
    return String(r.data).slice(0, 4000).trim()
  } catch {
    return ''
  }
}

// Get the Google account email associated with these Drive tokens
export async function getDriveUserEmail(tokens: any): Promise<string> {
  try {
    const auth = makeOAuth2()
    auth.setCredentials(tokens)
    const drive = google.drive({ version: 'v3', auth })
    const r = await drive.about.get({ fields: 'user' })
    return r.data.user?.emailAddress ?? ''
  } catch {
    return ''
  }
}
