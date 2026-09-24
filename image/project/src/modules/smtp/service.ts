import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import nodemailer, { type Transporter } from "nodemailer"

type Options = {
  host: string
  port: number
  secure: boolean // SMTPS (implicit TLS, usually port 465)
  requireTls: boolean // STARTTLS required (usually port 587)
  user?: string
  password?: string
  from?: string
}

type Dependencies = { logger: Logger }

// The notification's `content` carries the email: { subject, html, text }
// (built by src/lib/email.ts); `from` overrides the default sender.
class SmtpNotificationService extends AbstractNotificationProviderService {
  static identifier = "smtp"

  protected readonly options: Options
  protected readonly logger: Logger
  protected transporter?: Transporter

  constructor({ logger }: Dependencies, options: Options) {
    super()
    this.options = options
    this.logger = logger
  }

  protected getTransporter(): Transporter {
    if (!this.options.host) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "SMTP_HOST is not set: emails are disabled")
    }
    this.transporter ??= nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      requireTLS: this.options.requireTls,
      auth: this.options.user ? { user: this.options.user, pass: this.options.password } : undefined,
    })
    return this.transporter
  }

  async send(notification: ProviderSendNotificationDTO): Promise<ProviderSendNotificationResultsDTO> {
    const content = notification.content ?? {}
    const info = await this.getTransporter().sendMail({
      from: notification.from || this.options.from,
      to: notification.to,
      subject: content.subject,
      html: content.html,
      text: content.text,
    })
    this.logger.info(`Email "${content.subject}" sent to ${notification.to} (${info.messageId})`)
    return { id: info.messageId }
  }
}

export default SmtpNotificationService
