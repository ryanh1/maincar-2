import { describe, expect, it } from 'vitest'

import {
  DEAL_STAGE_AMOUNT_REPORT,
  compileReport,
  type ReportConfig,
} from '../reportCompiler.js'

const DAY_BUCKETED_REPORT = {
  ...DEAL_STAGE_AMOUNT_REPORT,
  timeBucket: { field: 'createdAt', grain: 'day' },
  timeZone: { mode: 'viewer' },
} as ReportConfig

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

  it('binds the viewer IANA zone before truncating a local day bucket', () => {
    const query = compileReport(DAY_BUCKETED_REPORT, 'org-a', {
      viewerTimeZone: 'America/New_York',
    })

    expect(query.sql).toContain('date_trunc(\'day\', "deal"."createdAt" AT TIME ZONE \'UTC\' AT TIME ZONE ?)')
    expect(query.sql).toContain('GROUP BY 1, "stage"."id", "stage"."name"')
    expect(query.values).toEqual(['America/New_York', 'org-a'])
  })

  it('requires a resolved zone instead of falling back to the server zone', () => {
    expect(() => compileReport(DAY_BUCKETED_REPORT, 'org-a', {}))
      .toThrow('A viewer time zone is required for this report.')
  })

  it('rejects a fixed-offset abbreviation even when Intl accepts it', () => {
    expect(() => compileReport({
      ...DAY_BUCKETED_REPORT,
      timeZone: { mode: 'pinned', displayZone: 'EST' },
    }, 'org-a')).toThrow('Report time zones must be valid IANA time zones.')
  })

  it('uses the subject zone only when the report explicitly selects subject mode', () => {
    const query = compileReport({
      ...DAY_BUCKETED_REPORT,
      timeZone: { mode: 'subject', subjectUserId: 'user-subject' },
    }, 'org-a', { subjectTimeZone: 'Europe/London' })

    expect(query.values).toEqual(['Europe/London', 'org-a'])
  })

  it('uses the configured pinned zone for every viewer', () => {
    const query = compileReport({
      ...DAY_BUCKETED_REPORT,
      timeZone: { mode: 'pinned', displayZone: 'Asia/Kolkata' },
    }, 'org-a', { viewerTimeZone: 'America/New_York' })

    expect(query.values).toEqual(['Asia/Kolkata', 'org-a'])
  })
})
