// Emails of the stack's subscribers (src/subscribers): a simple HTML layout
// and plain-text version, sent through the notification module's `email`
// channel (the SMTP provider in src/modules/smtp). Texts in Spanish.
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"

export type Email = {
  to: string
  template: string
  subject: string
  // Paragraphs of plain text; a button link is added when `link` is set.
  paragraphs: string[]
  link?: { label: string; url: string }
}

const escape = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const storeName = (): string => process.env.MEDUSA_STORE_NAME || "Medusa"
export const siteUrl = (): string => process.env.MEDUSA_URL || ""

export const formatAmount = (amount: number, currency: string): string =>
  new Intl.NumberFormat(process.env.MEDUSA_LOCALE || "es-CL", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount)

export async function sendEmail(container: MedusaContainer, email: Email): Promise<void> {
  if (!process.env.SMTP_HOST) {
    container.resolve("logger").info(`SMTP_HOST not set: email "${email.subject}" to ${email.to} not sent`)
    return
  }
  const html = `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;padding:32px">
<h1 style="font-size:20px;margin:0 0 24px">${escape(storeName())}</h1>
${email.paragraphs.map((p) => `<p style="line-height:1.5">${escape(p)}</p>`).join("\n")}
${email.link ? `<p style="margin:32px 0"><a href="${escape(email.link.url)}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">${escape(email.link.label)}</a></p>` : ""}
</div></body></html>`
  const text = [...email.paragraphs, email.link ? `${email.link.label}: ${email.link.url}` : ""]
    .filter(Boolean)
    .join("\n\n")
  await container.resolve(Modules.NOTIFICATION).createNotifications({
    to: email.to,
    channel: "email",
    template: email.template,
    content: { subject: email.subject, html, text },
  })
}
