import cors from 'cors'
import express from 'express'

import { logger } from '../dependencies/logger.js'
import { WEB_ORIGIN } from './config.js'
import { requestId } from './middleware/requestId.js'
import authRouter from './routes/auth.js'
import callsRouter from './routes/calls.js'
import companiesRouter from './routes/companies.js'
import dealsRouter from './routes/deals.js'
import emailRouter from './routes/email.js'
import emailsRouter from './routes/emails.js'
import attributesRouter from './routes/attributes.js'
import integrationsRouter, { callbackRouter as integrationsCallbackRouter } from './routes/integrations.js'
import invitationsRouter from './routes/invitations.js'
import membersRouter from './routes/members.js'
import messagesRouter from './routes/messages.js'
import objectsRouter from './routes/objects.js'
import peopleRouter from './routes/people.js'
import phoneNumbersRouter from './routes/phoneNumbers.js'
import recordsRouter from './routes/records.js'
import teamRouter from './routes/team.js'
import twilioVoiceRouter from './routes/twilioVoice.js'

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

// Mounted at /api, not /api/team: the caller has no team yet, which is the
// point of an invite. The router owns both /api/public/invitations/:token and
// /api/invitations/:token/accept.
app.use('/api', invitationsRouter)

app.use('/api/auth', authRouter)
app.use('/api/team', teamRouter)

// Mounted at /api/email rather than under /api/orgs/:orgId: the org sits inside
// this router's own paths (/orgs/:orgId/drafts), which keeps every route the
// composer will ever add — drafts today, templates and send later — under one
// prefix a reader can find.
app.use('/api/email', emailRouter)

// The org is in the path, so the tenant boundary is checked per request rather
// than read from the caller's currentOrgId preference.
app.use('/api/orgs/:orgId/phone-numbers', phoneNumbersRouter)
app.use('/api/orgs/:orgId/calls', callsRouter)
app.use('/api/orgs/:orgId/companies', companiesRouter)
app.use('/api/orgs/:orgId/people', peopleRouter)
app.use('/api/orgs/:orgId/deals', dealsRouter)
app.use('/api/orgs/:orgId/members', membersRouter)

// Logged email activity (MAI-137 T9). READ ONLY: composing and mailbox sync are a
// later spec. Distinct from /api/email above, which is the COMPOSER (drafts and
// templates — half-written mail that has not happened yet); this is the record of
// mail that HAS. Org-scoped like the rest of the CRM, with the org in the path.
app.use('/api/orgs/:orgId/emails', emailsRouter)

// Logged text activity (MAI-138 T10). READ ONLY for the same reason: sending, and
// the Twilio inbound/status webhooks that will write these rows, are a later spec.
// "messages" rather than "sms" because the table is a superset — MMS today, RCS
// and WhatsApp on the same rows later, told apart by `channel`.
app.use('/api/orgs/:orgId/messages', messagesRouter)

// Schema-as-data (MAI-133 T5): ObjectDef + AttributeDef describe every object and
// field. Both org-scoped; the org is in the path so the tenant boundary is checked
// per request. attributes carry their objectId in the body/query rather than a
// nested mount, matching the flat one-router-per-thing convention above.
app.use('/api/orgs/:orgId/objects', objectsRouter)
app.use('/api/orgs/:orgId/attributes', attributesRouter)
// Rows of custom (record-backed) objects (MAI-135 T7). Every valuesJson write goes
// through the one validator; filtering hits the native GIN index via containment.
app.use('/api/orgs/:orgId/records', recordsRouter)

// The authenticated half of the Integration Hub. The org is in the path so
// membership is re-proven per request. The OAuth callback is NOT here: it is
// unauthenticated and not org-scoped, and mounts on its own in a later ticket.
app.use('/api/integrations/orgs/:orgId', integrationsRouter)

// The OAuth callback: the module's ONE unauthenticated route. The provider redirects
// the rep's browser here to a fixed, org-less URI, so it mounts on its own — not under
// /orgs/:orgId and not behind requireAuth. The signed `state` it carries is what says
// whose consent it is (see the route's own header). Its /:provider/callback path never
// collides with the /orgs/:orgId router above, whose third segment is literally "orgs".
app.use('/api/integrations', integrationsCallbackRouter)

// Twilio's voice webhook. Mounted at /api/twilio (the router owns /voice, and the
// status callback /voice/status lands here later). Deliberately NOT org-scoped
// and NOT behind requireAuth: the caller is Twilio, authenticated by its request
// signature inside the router, not by an ID token. It parses its own urlencoded
// bodies, since the app is otherwise JSON-only.
app.use('/api/twilio', twilioVoiceRouter)

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
