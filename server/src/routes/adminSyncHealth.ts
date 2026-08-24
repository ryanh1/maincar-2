import { Router } from 'express'

import { wrapRoute } from '../lib/fnWrapper.js'
import { getSyncHealthReport } from '../lib/syncHealth.js'
import { requireAuth, requireSuperadmin } from '../middleware/auth.js'

const router = Router()

router.get(
  '/sync-health',
  requireAuth,
  requireSuperadmin,
  wrapRoute('GET /api/admin/sync-health', async (_req, res) => {
    return void res.json({ syncHealth: await getSyncHealthReport() })
  }),
)

export default router
