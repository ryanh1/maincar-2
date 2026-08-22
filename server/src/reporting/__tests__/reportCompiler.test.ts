import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_EVENT_COUNTS_GRID_REPORT,
  buildActivityGridRows,
  DIALER_CONNECT_RATE_BY_NUMBER_REPORT,
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

  it('adds the shared scope\'s deduplicated owner ids to a Deals query', () => {
    const query = compileReport({
      ...DEAL_STAGE_AMOUNT_REPORT,
      filters: { ownerTeam: { teamIds: ['team-a'], leadUserIds: ['lead-b'] } },
    }, 'org-a', { ownerTeamUserIds: ['owner-a', 'owner-b'] })

    expect(query.sql).toContain('"deal"."ownerUserId" IN (?,?)')
    expect(query.values).toEqual(['org-a', 'owner-a', 'owner-b'])
  })

  it('compiles an Owner-by-Stage pivot through registry-owned joins and grouping', () => {
    const query = compileReport({
      baseObject: 'deal',
      rows: [{ field: 'owner' }],
      columns: [{ field: 'stage' }],
      values: [{ field: 'amountMinor', aggregation: 'sum' }],
      timeZone: { mode: 'viewer' },
    }, 'org-a', { viewerTimeZone: 'America/New_York' })

    expect(query.sql).toContain('LEFT JOIN "User" AS "owner"')
    expect(query.sql).toContain('INNER JOIN "PipelineStage" AS "stage"')
    expect(query.sql).toContain('GROUP BY COALESCE("owner"."id", \'unassigned\')')
    expect(query.sql).toContain('"stage"."id", "stage"."name"')
    expect(query.values).toEqual(['org-a'])
  })

  it('rejects the same dimension appearing in more than one zone', () => {
    expect(() => compileReport({
      baseObject: 'deal',
      rows: [{ field: 'stage' }],
      columns: [{ field: 'stage' }],
      values: [{ field: 'amountMinor', aggregation: 'sum' }],
      timeZone: { mode: 'viewer' },
    }, 'org-a', { viewerTimeZone: 'America/New_York' })).toThrow('A field can appear in only one pivot zone.')
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

  it('compiles the activity event-count grid as local week buckets scoped to its org', () => {
    const query = compileReport(ACTIVITY_EVENT_COUNTS_GRID_REPORT, 'org-a', {
      viewerTimeZone: 'America/New_York',
    })

    expect(query.sql).toContain('FROM "ActivityEntry" AS "activity"')
    expect(query.sql).toContain('date_trunc(\'week\', "activity"."occurredAt" AT TIME ZONE \'UTC\' AT TIME ZONE ?)')
    expect(query.sql).toContain('"activity"."sourceType" IN (\'call\', \'email\', \'meeting\')')
    expect(query.sql).toContain('"activity"."orgId" = ?')
    expect(query.sql).toContain('COUNT(*)::text AS "count"')
    expect(query.values).toEqual(['America/New_York', 'org-a'])
  })

  it('compiles stage-entry counts from indexed Deal.stageId history and keeps metric input bound', () => {
    const config = {
      baseObject: 'activityGrid',
      metrics: [
        { key: 'calls', type: 'event_count', sourceType: 'call' },
        { key: 'entered-qualified', type: 'stage_entry', stageId: 'stage-qualified' },
        { key: 'qualified-per-call', type: 'conversion', numeratorKey: 'entered-qualified', denominatorKey: 'calls' },
      ],
      timeZone: { mode: 'viewer' },
      timeBucket: { field: 'occurredAt', grain: 'week' },
    } as const satisfies ReportConfig

    const query = compileReport(config, 'org-a', { viewerTimeZone: 'America/New_York' })

    expect(query.sql).toContain('FROM "FieldHistory" AS "history"')
    expect(query.sql).toContain('"history"."objectSlug" = \'deal\'')
    expect(query.sql).toContain('"history"."attribute" = \'stageId\'')
    expect(query.sql).toContain('"history"."newJson" = to_jsonb(?::text)')
    expect(query.sql).toContain('UNION ALL')
    expect(query.values).toEqual([
      'America/New_York', 'calls', 'org-a', 'call',
      'America/New_York', 'entered-qualified', 'org-a', 'stage-qualified',
    ])
  })

  it('adds conversion rows from the two named count rows and leaves zero denominators unavailable', () => {
    const config = {
      baseObject: 'activityGrid',
      metrics: [
        { key: 'calls', type: 'event_count', sourceType: 'call' },
        { key: 'entered-qualified', type: 'stage_entry', stageId: 'stage-qualified' },
        { key: 'qualified-per-call', type: 'conversion', numeratorKey: 'entered-qualified', denominatorKey: 'calls' },
      ],
      timeZone: { mode: 'viewer' },
      timeBucket: { field: 'occurredAt', grain: 'week' },
    } as const satisfies ReportConfig

    expect(buildActivityGridRows(config, [
      { weekStart: '2026-08-17', metricKey: 'calls', metricType: 'event_count', count: '4' },
      { weekStart: '2026-08-17', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '2' },
      { weekStart: '2026-08-24', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '1' },
    ])).toEqual([
      { weekStart: '2026-08-17', metricKey: 'calls', metricType: 'event_count', count: '4' },
      { weekStart: '2026-08-17', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '2' },
      { weekStart: '2026-08-17', metricKey: 'qualified-per-call', metricType: 'conversion', ratio: 0.5 },
      { weekStart: '2026-08-24', metricKey: 'calls', metricType: 'event_count', count: '0' },
      { weekStart: '2026-08-24', metricKey: 'entered-qualified', metricType: 'stage_entry', count: '1' },
      { weekStart: '2026-08-24', metricKey: 'qualified-per-call', metricType: 'conversion', ratio: null },
    ])
  })

  it('compiles the dialer number report from rollups, with no caller-controlled SQL identifiers', () => {
    const query = compileReport(DIALER_CONNECT_RATE_BY_NUMBER_REPORT, 'org-a')

    expect(query.sql).toContain('FROM "AnalyticsRollup" AS "rollup"')
    expect(query.sql).toContain('"rollup"."numberE164" AS "numberE164"')
    expect(query.sql).toContain('SUM("rollup"."dials")::text AS "dials"')
    expect(query.sql).toContain('SUM("rollup"."connects")::text AS "connects"')
    expect(query.sql).toContain('"rollup"."orgId" = ?')
    expect(query.values).toEqual(['org-a'])
  })
})
