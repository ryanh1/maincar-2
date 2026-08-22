import { describe, expect, it } from 'vitest'

import { STANDARD_OBJECTS, STANDARD_OBJECT_SURFACE_CAPABILITIES } from '../standardObjects.js'
import { getObjectSurfaceCapabilities } from '../objectCapabilities.js'
import { getRecordListSurface } from '../recordList.js'

describe('object surface capability registry', () => {
  it('requires every standard object to declare its surface capabilities', () => {
    expect(Object.keys(STANDARD_OBJECT_SURFACE_CAPABILITIES).sort()).toEqual(
      STANDARD_OBJECTS.map((object) => object.slug).sort(),
    )
  })

  it('advertises a grid/list surface only when its list implementation exists', () => {
    for (const object of STANDARD_OBJECTS) {
      expect(
        getObjectSurfaceCapabilities(object).list,
        `${object.slug} advertises list=${String(getObjectSurfaceCapabilities(object).list)}`,
      ).toBe(getRecordListSurface(object) !== null)
    }
  })

  it('makes every custom record-backed object listable without a client-side allow-list', () => {
    expect(getObjectSurfaceCapabilities({ slug: 'renewal', storage: 'record' }).list).toBe(true)
    expect(getRecordListSurface({ slug: 'renewal', storage: 'record' })).not.toBeNull()
  })
})
