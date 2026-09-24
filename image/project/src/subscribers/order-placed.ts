// Emails the customer an order confirmation (order number, items, total).
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { formatAmount, sendEmail, storeName } from "../lib/email"

export default async function orderPlaced({ event, container }: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: ["display_id", "email", "currency_code", "total", "items.title", "items.quantity", "items.total"],
    filters: { id: event.data.id },
  })
  if (!order?.email) {
    return
  }
  const currency = order.currency_code
  await sendEmail(container, {
    to: order.email,
    template: "order-placed",
    subject: `Pedido #${order.display_id} recibido - ${storeName()}`,
    paragraphs: [
      `Gracias por su compra. Recibimos su pedido #${order.display_id}:`,
      ...(order.items ?? []).map(
        (item) => `${item?.quantity} × ${item?.title}: ${formatAmount(Number(item?.total ?? 0), currency)}`
      ),
      `Total: ${formatAmount(Number(order.total ?? 0), currency)}`,
    ],
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
