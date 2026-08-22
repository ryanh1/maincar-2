import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Prisma } from '../src/generated/prisma/client.js'
import { STANDARD_OBJECTS, type SeedAttribute, type SeedObject } from '../src/crm/standardObjects.js'

const outputPath = path.resolve(import.meta.dirname, '../../docs/generated/schema.md')
const prismaSchemaPath = path.resolve(import.meta.dirname, '../prisma/schema.prisma')
const generatedAtPattern = /^> Generated at: (.+)$/m

export interface DumpAttribute extends Pick<SeedAttribute, 'name' | 'slug' | 'type' | 'storage'> {
  isMulti?: boolean
  isRequired?: boolean
  isUnique?: boolean
  isSystem?: boolean
  defaultJson?: unknown
  optionsJson?: unknown
  refObjectName?: string
}

export interface DumpObject extends Pick<SeedObject, 'name' | 'namePlural' | 'slug' | 'storage'> {
  attributes: DumpAttribute[]
}

interface DmmfField {
  name: string
  type: string
  isList: boolean
  isRequired: boolean
  isId: boolean
  isUpdatedAt: boolean
  hasDefaultValue: boolean
  default?: unknown
  relationName?: string
}

interface DmmfModel {
  name: string
  fields: DmmfField[]
}

function prismaModels(): DmmfModel[] {
  const dmmf = (Prisma as unknown as { dmmf?: { datamodel: { models: DmmfModel[] } } }).dmmf
  if (dmmf) return dmmf.datamodel.models

  // Prisma 7's `prisma-client` generator no longer exposes `Prisma.dmmf` at
  // runtime. Its generated client still embeds the schema, but parsing the
  // checked-in source here keeps the dump usable until that API returns.
  const schema = readFileSync(prismaSchemaPath, 'utf8')
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
    name,
    fields: body.split('\n').flatMap((line) => {
      const declaration = line.match(/^\s*(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/)
      if (!declaration || declaration[1].startsWith('@')) return []
      const [, fieldName, type, list, optional, attributes] = declaration
      const defaultValue = attributes.match(/@default\((.+)\)/)?.[1]
      return [{
        name: fieldName,
        type,
        isList: list === '[]',
        isRequired: optional !== '?',
        isId: attributes.includes('@id'),
        isUpdatedAt: attributes.includes('@updatedAt'),
        hasDefaultValue: defaultValue !== undefined,
        default: defaultValue,
        relationName: attributes.match(/@relation\("([^"]+)"/)?.[1],
      }]
    }),
  }))
}

export interface RenderSchemaDumpOptions {
  generatedAt: string
  source?: string
  objects?: DumpObject[]
}

function prismaType(attribute: DumpAttribute): string {
  const typeByAttributeType: Record<string, string> = {
    text: 'String',
    phone: 'String',
    email: 'String',
    url: 'String',
    domain: 'String',
    location: 'String',
    person_name: 'String',
    number: 'Float',
    currency: 'Decimal',
    rating: 'Int',
    checkbox: 'Boolean',
    date: 'DateTime',
    timestamp: 'DateTime',
    select: 'String',
    multiselect: 'String',
    status: 'String',
    record_reference: 'String',
    user_reference: 'String',
    ai: 'Json',
  }
  const prismaType = typeByAttributeType[attribute.type]
  if (!prismaType) throw new Error(`Unknown AttributeDef type: ${attribute.type}`)
  if (attribute.isMulti) return `${prismaType}[]`
  return attribute.isRequired ? prismaType : `${prismaType}?`
}

function enumValues(options: unknown): string | null {
  if (!Array.isArray(options)) return null
  const values = options.flatMap((option) => {
    if (!option || typeof option !== 'object') return []
    const { value, isArchived } = option as { value?: unknown; isArchived?: unknown }
    return typeof value === 'string' && isArchived !== true ? [value] : []
  })
  return values.length === 0 ? null : values.join(' | ')
}

function dynamicFieldComment(attribute: DumpAttribute): string {
  const comments: string[] = []
  if (attribute.type === 'select' || attribute.type === 'multiselect' || attribute.type === 'status') {
    const values = enumValues(attribute.optionsJson)
    if (values) comments.push(`enum: ${values}`)
  }
  if (attribute.type === 'record_reference' || attribute.type === 'user_reference') {
    comments.push(`→ ${attribute.refObjectName ?? (attribute.type === 'user_reference' ? 'User' : 'Record')}`)
  }
  if (attribute.storage === 'column') comments.push('column')
  if (attribute.storage === 'custom') comments.push('JSON')
  if (attribute.storage === 'list') comments.push('list JSON')
  if (attribute.isSystem) comments.push('system')
  if (attribute.isRequired) comments.push('required')
  if (attribute.isUnique) comments.push('unique')
  if (attribute.defaultJson !== undefined && attribute.defaultJson !== null) {
    comments.push(`default: ${JSON.stringify(attribute.defaultJson)}`)
  }
  return comments.length === 0 ? '' : ` // ${comments.join('; ')}`
}

function renderDynamicObject(object: DumpObject): string {
  const fields = object.attributes
    .map((attribute) => `  ${attribute.slug.padEnd(16)} ${prismaType(attribute)}${dynamicFieldComment(attribute)}`)
    .join('\n')
  const plural = object.namePlural === object.name ? object.name : `${object.namePlural} (${object.name})`

  return [
    `### ${object.name}`,
    '',
    `Storage kind: **schema-as-data ${object.storage === 'record' ? 'Record + valuesJson' : 'table definition + customJson'}**.`,
    `Seed/object slug: \`${object.slug}\` · Display: ${plural}.`,
    '',
    '```prisma',
    `model ${object.name} {`,
    fields,
    '}',
    '```',
  ].join('\n')
}

function dmmfFieldComment(field: DmmfField): string {
  const comments: string[] = []
  if (field.isId) comments.push('id')
  if (field.isUpdatedAt) comments.push('updatedAt')
  if (field.relationName) comments.push(`relation: ${field.relationName}`)
  if (field.hasDefaultValue) comments.push(`default: ${JSON.stringify(field.default)}`)
  return comments.length === 0 ? '' : ` // ${comments.join('; ')}`
}

function renderPrismaModel(model: DmmfModel): string {
  const fields = model.fields
    .map((field) => {
      const type = `${field.type}${field.isList ? '[]' : field.isRequired ? '' : '?'}`
      return `  ${field.name.padEnd(24)} ${type}${dmmfFieldComment(field)}`
    })
    .join('\n')

  return [
    `### ${model.name}`,
    '',
    'Storage kind: **real Prisma table**.',
    '',
    '```prisma',
    `model ${model.name} {`,
    fields,
    '}',
    '```',
  ].join('\n')
}

function seededObjects(): DumpObject[] {
  const objectNameBySlug = new Map(STANDARD_OBJECTS.map((object) => [object.slug, object.name]))
  return STANDARD_OBJECTS.map((object) => ({
    ...object,
    attributes: object.attributes.map((attribute) => ({
      ...attribute,
      refObjectName: attribute.refObjectSlug ? objectNameBySlug.get(attribute.refObjectSlug) : undefined,
    })),
  }))
}

export function renderSchemaDump({
  generatedAt,
  source = 'seeded standard-object definitions',
  objects = seededObjects(),
}: RenderSchemaDumpOptions): string {
  const models = prismaModels()
  return [
    '# Maincar schema',
    '',
    '> AUTO-GENERATED — DO NOT EDIT BY HAND.',
    `> Generated at: ${generatedAt}`,
    `> Dynamic-object source: ${source}.`,
    '> Journey: [4.S4 — Generate a Prisma-style schema markdown](../journeys/4-crm-data-and-views.md#journey-4s4--generate-a-prisma-style-schema-markdown-for-every-object-internal-engineering-tool).',
    '',
    '## Dynamic objects (schema-as-data)',
    '',
    ...objects.flatMap((object) => [renderDynamicObject(object), '']),
    '## Real Prisma tables',
    '',
    ...models.flatMap((model) => [renderPrismaModel(model), '']),
  ].join('\n')
}

async function workspaceObjects(workspaceId: string): Promise<DumpObject[]> {
  const { default: prisma } = await import('../src/db.js')
  try {
    const objects = await prisma.objectDef.findMany({
      where: { orgId: workspaceId, isArchived: false, deletedAt: null },
      include: {
        attributes: {
          where: { isArchived: false, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })
    const objectNameById = new Map(objects.map((object) => [object.id, object.name]))
    return objects.map((object) => ({
      name: object.name,
      namePlural: object.namePlural,
      slug: object.slug,
      storage: object.storage === 'record' ? 'record' : 'table',
      attributes: object.attributes.map((attribute) => ({
        name: attribute.name,
        slug: attribute.slug,
        type: attribute.type,
        storage: attribute.storage as DumpAttribute['storage'],
        isMulti: attribute.isMulti,
        isRequired: attribute.isRequired,
        isUnique: attribute.isUnique,
        isSystem: attribute.isSystem,
        defaultJson: attribute.defaultJson,
        optionsJson: attribute.optionsJson,
        refObjectName: attribute.refObjectId ? objectNameById.get(attribute.refObjectId) : undefined,
      })),
    }))
  } finally {
    await prisma.$disconnect()
  }
}

function parseArguments(args: string[]): { check: boolean; workspaceId?: string } {
  let check = false
  let workspaceId: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--workspace') {
      workspaceId = args[index + 1]
      if (!workspaceId || workspaceId.startsWith('--')) throw new Error('--workspace requires an id.')
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }
  return { check, workspaceId }
}

async function existingGeneratedAt(): Promise<string | null> {
  try {
    const existing = await readFile(outputPath, 'utf8')
    return existing.match(generatedAtPattern)?.[1] ?? null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function runSchemaDump(args: string[]): Promise<void> {
  const { check, workspaceId } = parseArguments(args)
  const previousTimestamp = check ? await existingGeneratedAt() : null
  const objects = workspaceId ? await workspaceObjects(workspaceId) : undefined
  const markdown = renderSchemaDump({
    generatedAt: previousTimestamp ?? new Date().toISOString(),
    source: workspaceId ? `workspace ${workspaceId}` : undefined,
    objects,
  })

  if (check) {
    const existing = await readFile(outputPath, 'utf8').catch(() => '')
    if (existing !== markdown) {
      throw new Error(`${path.relative(process.cwd(), outputPath)} is stale. Run npm run schema:dump.`)
    }
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, markdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSchemaDump(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
