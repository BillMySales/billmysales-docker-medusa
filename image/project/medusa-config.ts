// Medusa configuration of the Docker stack: everything comes from the
// environment at runtime (compose.yaml), so the image doesn't depend on the
// site's URL or secrets.
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "production", process.cwd())

const env = (name: string, fallback = ""): string => process.env[name] || fallback
const redisUrl = env("REDIS_URL")
const url = env("MEDUSA_URL")
// Browser origins allowed to call the Store API (storefronts), plus the site.
const storeCors = [url, env("MEDUSA_STORE_CORS")].filter(Boolean).join(",")

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: env("DATABASE_URL"),
    redisUrl,
    workerMode: env("MEDUSA_WORKER_MODE", "shared") as "shared" | "worker" | "server",
    http: {
      storeCors,
      adminCors: url,
      authCors: storeCors,
      jwtSecret: env("MEDUSA_JWT_SECRET"),
      cookieSecret: env("MEDUSA_COOKIE_SECRET"),
    },
    // The admin's session cookie: Secure when the site is served over HTTPS.
    // (Medusa sets it whenever NODE_ENV=production, so over plain HTTP, e.g.
    // in development, the browser never gets it and the admin login fails.)
    cookieOptions: { secure: url.startsWith("https://") },
  },
  admin: {
    // Served by the server at /app; the admin calls the API on the same
    // address ("/"), so the image doesn't depend on the site's URL.
    disable: env("DISABLE_MEDUSA_ADMIN") === "true",
  },
  modules: [
    // Redis for events, workflows, locks and cache (several processes).
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      options: { redis: { redisUrl } },
    },
    {
      resolve: "@medusajs/medusa/locking",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/locking-redis",
            id: "locking-redis",
            is_default: true,
            options: { redisUrl },
          },
        ],
      },
    },
    {
      resolve: "@medusajs/medusa/caching",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/caching-redis",
            id: "caching-redis",
            is_default: true,
            options: { redisUrl },
          },
        ],
      },
    },
    // Uploads in the `static` volume, served by the server at /static.
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-local",
            id: "local",
            options: {
              upload_dir: "static",
              backend_url: `${url}/static`,
            },
          },
        ],
      },
    },
    // Emails through SMTP (src/modules/smtp); admin notifications in the feed.
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "./src/modules/smtp",
            id: "smtp",
            options: {
              channels: ["email"],
              host: env("SMTP_HOST"),
              port: Number(env("SMTP_PORT", "587")),
              secure: env("SMTP_SECURE").toLowerCase() === "ssl",
              requireTls: env("SMTP_SECURE").toLowerCase() === "tls",
              user: env("SMTP_USER"),
              password: env("SMTP_PASSWORD"),
              from: env("SMTP_FROM"),
            },
          },
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "feed",
            options: { channels: ["feed"] },
          },
        ],
      },
    },
  ],
})
