import { STANDARD_OBJECT_SURFACE_CAPABILITIES, type ObjectSurfaceCapabilities } from './standardObjects.js'

export type { ObjectSurfaceCapabilities } from './standardObjects.js'

export interface ObjectSurfaceCapabilitySubject {
  slug: string
  storage: string
}

const UNSUPPORTED_SURFACES: ObjectSurfaceCapabilities = { list: false }
const RECORD_SURFACES: ObjectSurfaceCapabilities = { list: true }

/**
 * The server-owned contract for every object's navigable data surfaces. Standard
 * objects declare their capabilities in the standard-object registry; custom
 * objects use the generic Record storage and are therefore listable by default.
 *
 * This is deliberately data, not a client allow-list. The API sends it with each
 * ObjectDef and clients render only the surfaces the server says are available.
 */
export function getObjectSurfaceCapabilities(object: ObjectSurfaceCapabilitySubject): ObjectSurfaceCapabilities {
  if (object.storage === 'record') return RECORD_SURFACES
  return STANDARD_OBJECT_SURFACE_CAPABILITIES[object.slug] ?? UNSUPPORTED_SURFACES
}
