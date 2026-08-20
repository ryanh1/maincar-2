import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from './generated/prisma/client.js'
import { DATABASE_URL } from './config.js'

// The single PrismaClient for the process. Import this — never construct another
// one in a route or a service, or the connection pool multiplies.
const adapter = new PrismaPg({ connectionString: DATABASE_URL })
const prisma = new PrismaClient({ adapter })

export default prisma
