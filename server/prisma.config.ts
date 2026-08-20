import 'dotenv/config'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig, env } from 'prisma/config'

// The Prisma CLI runs from server/, but the .env lives at the repo root, shared
// with the client. Load it explicitly — dotenv never overrides a var that is
// already set, so an env var passed on the command line still wins.
loadEnv({ path: path.resolve(import.meta.dirname, '../.env') })

// A pooled provider (Neon, Supabase pgbouncer) cannot run migrations through its
// transaction pooler, so migrations need a direct URL. Locally there is no pooler,
// so DIRECT_DATABASE_URL may be left unset and DATABASE_URL is used for both.
const directUrl = process.env.DIRECT_DATABASE_URL || undefined

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    ...(directUrl ? { directUrl } : {}),
  },
})
