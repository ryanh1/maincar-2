import cors from 'cors'
import express from 'express'

import { logger } from '../dependencies/logger.js'
import { WEB_ORIGIN } from './config.js'
import { requestId } from './middleware/requestId.js'
import authRouter from './routes/auth.js'
import teamRouter from './routes/team.js'

// The app is assembled here and started in index.ts. Keeping them apart is what
// lets supertest import the app without binding a port.
const app = express()

app.use(
  cors({
    origin(origin, callback) {
      // A request with no Origin header (curl, server-to-server, same-origin) is
      // not subject to CORS at all.
      if (!origin) return callback(null, true)
      if (origin === WEB_ORIGIN) return callback(null, true)
      return callback(new Error(`CORS: origin not allowed: ${origin}`))
    },
    credentials: true,
  }),
)

app.use(express.json({ limit: '2mb' }))
app.use(requestId)

// Unauthenticated on purpose: this is what a load balancer or `docker healthcheck`
// polls, and it must answer before anyone has signed in.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.use('/api/auth', authRouter)
app.use('/api/team', teamRouter)

app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` })
})

// The CORS rejection above throws, and without a handler Express would answer it
// with an HTML error page that a fetch() caller cannot read.
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ): void => {
    logger.error({ requestId: req.id, error: err }, 'unhandled error')
    res.status(500).json({ error: 'Internal server error' })
  },
)

export default app
