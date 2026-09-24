// SMTP notification provider (Medusa ships none): emails of the `email`
// channel sent with nodemailer. Configured in medusa-config.ts from SMTP_*.
import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import SmtpNotificationService from "./service"

export default ModuleProvider(Modules.NOTIFICATION, {
  services: [SmtpNotificationService],
})
