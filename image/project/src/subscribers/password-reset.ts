// Emails the password reset link: admin users to the admin, customers to the
// storefront (MEDUSA_STOREFRONT_URL + /reset-password, if set).
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendEmail, siteUrl, storeName } from "../lib/email"

type Data = { entity_id: string; token: string; actor_type: string }

export default async function passwordReset({ event, container }: SubscriberArgs<Data>) {
  const { entity_id: email, token, actor_type } = event.data
  const base = actor_type === "user" ? `${siteUrl()}/app` : process.env.MEDUSA_STOREFRONT_URL
  if (!base) {
    container.resolve("logger").info(`No MEDUSA_STOREFRONT_URL: password reset email for ${actor_type} not sent`)
    return
  }
  const query = `token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
  await sendEmail(container, {
    to: email,
    template: `password-reset-${actor_type}`,
    subject: `Restablecer su contraseña de ${storeName()}`,
    paragraphs: [
      "Recibimos una solicitud para restablecer su contraseña.",
      "Si no la hizo, ignore este correo; el enlace vence en unos minutos.",
    ],
    link: { label: "Restablecer contraseña", url: `${base}/reset-password?${query}` },
  })
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
