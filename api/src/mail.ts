import nodemailer from 'nodemailer'

function createTransport() {
  const host = process.env.SMTP_HOST?.trim()
  if (!host) return null
  const port = Number(process.env.SMTP_PORT || '587')
  const secure = process.env.SMTP_SECURE === 'true' || port === 465
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  })
}

export function isMailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.MAIL_FROM?.trim())
}

export async function sendMailSafe(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<void> {
  const transport = createTransport()
  const from = process.env.MAIL_FROM?.trim()
  if (!transport || !from) {
    console.warn('[mail] SMTP_HOST/MAIL_FROM nicht gesetzt – E-Mail übersprungen:', opts.subject)
    return
  }
  await transport.sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html ?? opts.text.replace(/\n/g, '<br/>'),
  })
}

export function vignetteAdminNotifyEmail(): string | null {
  const a = process.env.VIGNETTE_ADMIN_EMAIL?.trim()
  if (a) return a
  return process.env.MAIL_ADMIN_NOTIFY?.trim() || null
}
