import { describe, expect, it } from 'vitest'

import { renderSchemaDump, type DumpObject } from '../../scripts/schemaDump.js'

describe('schema:dump', () => {
  it('renders seeded schema-as-data objects before real Prisma tables', () => {
    const markdown = renderSchemaDump({ generatedAt: '2026-08-22T22:00:00.000Z' })

    expect(markdown).toContain('AUTO-GENERATED — DO NOT EDIT BY HAND')
    expect(markdown).toContain('Generated at: 2026-08-22T22:00:00.000Z')
    expect(markdown).toContain('## Dynamic objects (schema-as-data)')
    expect(markdown).toContain('## Real Prisma tables')
    expect(markdown.indexOf('### Company')).toBeLessThan(markdown.indexOf('### Org'))
  })

  it('maps dynamic field types and documents field metadata', () => {
    const markdown = renderSchemaDump({ generatedAt: '2026-08-22T22:00:00.000Z' })

    expect(markdown).toMatch(/amountMinor\s+Decimal\? \/\/ column; system/)
    expect(markdown).toMatch(/companyId\s+String\? \/\/ → Company; column; system/)
    expect(markdown).toMatch(/attentionStatus\s+String \/\/ enum: on_deck \| on_hold \| backburner \| disqualified; column; system; required/)
  })

  it('renders custom record objects and multi-value references from a workspace source', () => {
    const objects: DumpObject[] = [{
      name: 'Project',
      namePlural: 'Projects',
      slug: 'project',
      storage: 'record',
      attributes: [{
        name: 'Stakeholders',
        slug: 'stakeholders',
        type: 'record_reference',
        storage: 'custom',
        isMulti: true,
        refObjectName: 'Person',
      }],
    }]
    const markdown = renderSchemaDump({
      generatedAt: '2026-08-22T22:00:00.000Z',
      source: 'workspace org_123',
      objects,
    })

    expect(markdown).toContain('Dynamic-object source: workspace org_123.')
    expect(markdown).toContain('Storage kind: **schema-as-data Record + valuesJson**.')
    expect(markdown).toMatch(/stakeholders\s+String\[\] \/\/ → Person; JSON/)
  })

  it('renders every Prisma model from the DMMF', () => {
    const markdown = renderSchemaDump({ generatedAt: '2026-08-22T22:00:00.000Z' })

    expect(markdown).toContain('### Org')
    expect(markdown).toContain('### AttributeDef')
    expect(markdown).toContain('model Org {')
  })
})
