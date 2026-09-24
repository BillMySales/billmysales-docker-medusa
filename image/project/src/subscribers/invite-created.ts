// Emails an admin invitation (Settings > Users > Invite) with its link.
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { Modules } from "@medusajs/framework/utils"
import { sendEmail, siteUrl, storeName } from "../lib/email"

export default async function inviteCreated({ event, container }: SubscriberArgs<{ id: string }>) {
  const invite = await container.resolve(Modules.USER).retrieveInvite(event.data.id)
  await sendEmail(container, {
    to: invite.email,
    template: "invite",
    subject: `Invitación a ${storeName()}`,
    paragraphs: [
      `Fue invitado a administrar ${storeName()}.`,
      "Acepte la invitación y cree su contraseña con el siguiente enlace.",
    ],
    link: { label: "Aceptar invitación", url: `${siteUrl()}/app/invite?token=${encodeURIComponent(invite.token)}` },
  })
}

export const config: SubscriberConfig = {
  event: ["invite.created", "invite.resent"],
}
