interface SendEmailParams {
  to: string
  subject: string
  body: string
}

export async function sendEmail(_tokens: unknown, params: SendEmailParams): Promise<void> {
  console.warn('[gmail] sendEmail not implemented — would send to', params.to)
}
