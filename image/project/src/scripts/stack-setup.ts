// Run by the stack's setup service (`medusa exec`) after the migrations, on
// every `docker compose up`; safe to repeat:
// - The admin user (MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD), if missing
//   (like `medusa user`); its password is only set when it's created.
// - Once (marker: store metadata `docker_stack_initialized`): store name and
//   currency, a region for the country with its tax rate, prices including
//   tax, a stock location with a shipping option, the default sales channel
//   and a publishable API key for storefronts linked to it. Later changes in the admin
//   are kept. Each step reuses what exists, so a run that failed halfway
//   can be repeated.
// - Prints the publishable API keys (storefronts send one as
//   x-publishable-api-key).
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createPricePreferencesWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  createUsersWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

const env = (name: string, fallback = ""): string => process.env[name] || fallback

export default async function stackSetup({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  // Admin user.
  const email = env("MEDUSA_ADMIN_EMAIL")
  const [existing] = await container.resolve(Modules.USER).listUsers({ email })
  if (!existing) {
    const {
      result: [user],
    } = await createUsersWorkflow(container).run({ input: { users: [{ email }] } })
    const auth = container.resolve(Modules.AUTH)
    const { authIdentity, error } = await auth.register("emailpass", {
      body: { email, password: env("MEDUSA_ADMIN_PASSWORD") },
    })
    if (error || !authIdentity) {
      throw new Error(`Could not create the admin login: ${error}`)
    }
    await auth.updateAuthIdentities({ id: authIdentity.id, app_metadata: { user_id: user.id } })
    logger.info(`Admin user ${email} created`)
  }

  const storeModule = container.resolve(Modules.STORE)
  const [store] = await storeModule.listStores()
  if (!store.metadata?.docker_stack_initialized) {
    const currency = env("MEDUSA_CURRENCY", "clp").toLowerCase()
    const country = env("MEDUSA_COUNTRY", "cl").toLowerCase()
    logger.info(`Initial store settings (${country}, ${currency})`)

    let [salesChannel] = await container
      .resolve(Modules.SALES_CHANNEL)
      .listSalesChannels({ name: "Default Sales Channel" })
    if (!salesChannel) {
      const { result } = await createSalesChannelsWorkflow(container).run({
        input: { salesChannelsData: [{ name: "Default Sales Channel" }] },
      })
      salesChannel = result[0]
    }

    await updateStoresWorkflow(container).run({
      input: {
        selector: { id: store.id },
        update: {
          name: env("MEDUSA_STORE_NAME", "Medusa Store"),
          supported_currencies: [{ currency_code: currency, is_default: true }],
          default_sales_channel_id: salesChannel.id,
        },
      },
    })

    const regionName = env("MEDUSA_REGION_NAME", "Chile")
    let [region] = await container.resolve(Modules.REGION).listRegions({ name: regionName })
    if (!region) {
      const { result } = await createRegionsWorkflow(container).run({
        input: {
          regions: [
            {
              name: regionName,
              currency_code: currency,
              countries: [country],
              payment_providers: ["pp_system_default"],
            },
          ],
        },
      })
      region = result[0]
    }

    const taxRate = Number(env("MEDUSA_TAX_RATE", "19"))
    const [taxRegion] = await container.resolve(Modules.TAX).listTaxRegions({ country_code: country })
    if (!taxRegion) {
      await createTaxRegionsWorkflow(container).run({
        input: [
          {
            country_code: country,
            provider_id: "tp_system",
            default_tax_rate: taxRate
              ? { rate: taxRate, code: env("MEDUSA_TAX_CODE", "iva"), name: env("MEDUSA_TAX_NAME", "IVA") }
              : undefined,
          },
        ],
      })
    }

    // Price preferences (Medusa creates the currency's one with the store
    // currency): update them, or create the missing ones.
    const pricing = container.resolve(Modules.PRICING)
    const taxInclusive = env("MEDUSA_PRICES_INCLUDE_TAX", "true") === "true"
    const missing: { attribute: string; value: string; is_tax_inclusive: boolean }[] = []
    for (const [attribute, value] of [
      ["currency_code", currency],
      ["region_id", region.id],
    ]) {
      const [preference] = await pricing.listPricePreferences({ attribute, value })
      if (preference) {
        await pricing.updatePricePreferences(preference.id, { is_tax_inclusive: taxInclusive })
      } else {
        missing.push({ attribute, value, is_tax_inclusive: taxInclusive })
      }
    }
    if (missing.length) {
      await createPricePreferencesWorkflow(container).run({ input: missing })
    }

    const locationName = env("MEDUSA_STOCK_LOCATION", "Bodega")
    let [location] = await container.resolve(Modules.STOCK_LOCATION).listStockLocations({ name: locationName })
    if (!location) {
      const { result } = await createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: locationName,
              address: { address_1: "", city: env("MEDUSA_CITY", "Santiago"), country_code: country.toUpperCase() },
            },
          ],
        },
      })
      location = result[0]
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
      })
    }
    await updateStoresWorkflow(container).run({
      input: { selector: { id: store.id }, update: { default_location_id: location.id } },
    })

    // A shipping zone for the country and one free shipping option, so
    // checkout works; prices and options are edited in the admin.
    const fulfillment = container.resolve(Modules.FULFILLMENT)
    let [profile] = await fulfillment.listShippingProfiles({ type: "default" })
    if (!profile) {
      const { result } = await createShippingProfilesWorkflow(container).run({
        input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
      })
      profile = result[0]
    }
    const setName = `${location.name} - envíos`
    let [fulfillmentSet] = await fulfillment.listFulfillmentSets({ name: setName }, { relations: ["service_zones"] })
    if (!fulfillmentSet) {
      fulfillmentSet = await fulfillment.createFulfillmentSets({
        name: setName,
        type: "shipping",
        service_zones: [{ name: region.name, geo_zones: [{ country_code: country, type: "country" }] }],
      })
      await link.create({
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
        [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
      })
    }
    const zoneId = fulfillmentSet.service_zones[0].id
    const options = await fulfillment.listShippingOptions({ service_zone: { id: zoneId } })
    if (!options.length) await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Despacho",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: zoneId,
          shipping_profile_id: profile.id,
          type: { label: "Despacho", description: "Despacho a domicilio", code: "standard" },
          prices: [
            { currency_code: currency, amount: 0 },
            { region_id: region.id, amount: 0 },
          ],
          rules: [
            { attribute: "enabled_in_store", value: "true", operator: "eq" },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    })
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: location.id, add: [salesChannel.id] },
    })

    // Medusa creates a default publishable key; create one only if none.
    let [apiKey] = (await container.resolve(Modules.API_KEY).listApiKeys({ type: "publishable" })).filter(
      (key) => !key.revoked_at
    )
    if (!apiKey) {
      const { result } = await createApiKeysWorkflow(container).run({
        input: { api_keys: [{ title: "Storefront", type: "publishable", created_by: "" }] },
      })
      apiKey = result[0]
    }
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: apiKey.id, add: [salesChannel.id] },
    })

    // Marker last: a failed step above is retried on the next run.
    await storeModule.updateStores(store.id, {
      metadata: { ...(store.metadata ?? {}), docker_stack_initialized: new Date().toISOString() },
    })
  }

  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["token", "title"],
    filters: { type: "publishable", revoked_at: null },
  })
  for (const key of keys) {
    logger.info(`Publishable API key "${key.title}": ${key.token}`)
  }
}
