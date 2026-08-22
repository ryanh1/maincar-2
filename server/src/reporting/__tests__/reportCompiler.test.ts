import { describe, expect, it } from 'vitest'

import {
  DEAL_STAGE_AMOUNT_REPORT,
  compileReport,
} from '../reportCompiler.js'

describe('compileReport', () => {
  it('compiles the first Deals report through the registry and injects the org boundary', () => {
    const query = compileReport(DEAL_STAGE_AMOUNT_REPORT, 'org-a')

    expect(query.sql).toContain('FROM "Deal" AS "deal"')
    expect(query.sql).toContain('INNER JOIN "PipelineStage" AS "stage"')
    expect(query.sql).toContain('"deal"."orgId" = ?')
    expect(query.sql).toContain('SUM("deal"."amountMinor")')
    expect(query.sql).toContain('GROUP BY "stage"."id", "stage"."name"')
    expect(query.values).toEqual(['org-a'])
  })
})
