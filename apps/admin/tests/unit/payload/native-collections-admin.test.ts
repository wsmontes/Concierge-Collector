import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollectionConfig } from 'payload'
import { describe, expect, test } from 'vitest'
import * as accessCells from '../../../src/components/content/cells/CollectionAccessCell'
import * as booleanCells from '../../../src/components/content/cells/BooleanCell'
import * as monoCells from '../../../src/components/content/cells/MonoCell'
import * as dateCells from '../../../src/components/content/cells/RelativeDateCell'
import * as statusCells from '../../../src/components/content/cells/StatusCell'
import { CMS_NAV_GROUPS } from '../../../src/components/shell/nav-groups'
import { CmsUsers } from '../../../src/payload/collections/CmsUsers'
import { ConsumerApplications } from '../../../src/payload/collections/ConsumerApplications'
import { ConsumerCredentials } from '../../../src/payload/collections/ConsumerCredentials'

/**
 * Contrato das três collections nativas expostas no menu: colunas, grupo,
 * descrição, busca e — o que mais quebra em silêncio — a ligação entre o path
 * string do campo e o componente de célula que ele promete renderizar.
 */

const NATIVE: CollectionConfig[] = [CmsUsers, ConsumerApplications, ConsumerCredentials]

/**
 * `resolve` a partir do diretório do arquivo, e não por `new URL(..., import.meta.url)`:
 * o Vite transforma esse padrão em resolução de asset e devolve uma URL que não é
 * `file:`.
 */
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** Módulos que os campos referenciam, para conferir o export nomeado de verdade. */
const CELL_MODULES: Record<string, Record<string, unknown>> = {
  '/src/components/content/cells/BooleanCell': booleanCells,
  '/src/components/content/cells/CollectionAccessCell': accessCells,
  '/src/components/content/cells/MonoCell': monoCells,
  '/src/components/content/cells/RelativeDateCell': dateCells,
  '/src/components/content/cells/StatusCell': statusCells,
}

type FieldWithAdmin = {
  admin?: { components?: { Cell?: unknown }; hidden?: boolean }
  label?: unknown
  name?: string
}

interface RegisteredCell {
  collection: string
  exportName: string
  field: string
  path: string
}

function cellOf(field: FieldWithAdmin): RegisteredCell['path'] | null {
  const cell = field.admin?.components?.Cell
  if (!cell) return null
  return typeof cell === 'string' ? cell : String((cell as { path: string }).path)
}

const REGISTERED: RegisteredCell[] = NATIVE.flatMap((collection) =>
  (collection.fields as FieldWithAdmin[]).flatMap((field) => {
    const reference = cellOf(field)
    if (!reference) return []

    const [path, exportName = 'default'] = reference.split('#')
    return [{ collection: collection.slug, exportName, field: field.name ?? '', path }]
  }),
)

const columnsOf = (collection: CollectionConfig): string[] => collection.admin?.defaultColumns ?? []
const nameOf = (collection: CollectionConfig, field: FieldWithAdmin): string => String(field.name)

test.each([
  ['cms-users', 'authorized', 'BooleanCell'],
  ['cms-users', 'lastIntrospectedAt', 'RelativeDateCell'],
  ['consumer-applications', 'status', 'ApplicationStatusCell'],
  ['consumer-applications', 'allowedCollectionIds', 'CollectionAccessCell'],
  ['consumer-credentials', 'applicationId', 'MonoCell'],
  ['consumer-credentials', 'prefix', 'MonoCell'],
  ['consumer-credentials', 'status', 'CredentialStatusCell'],
  ['consumer-credentials', 'lastUsedAt', 'RelativeDateCell'],
])('%s.%s renders through %s', (slug, field, exportName) => {
  const registered = REGISTERED.find((each) => each.collection === slug && each.field === field)

  expect(registered, `${slug}.${field} não declara célula própria`).toBeDefined()
  expect(registered?.exportName).toBe(exportName)
})

describe('registered cells', () => {
  test('are client components that really export the referenced name', () => {
    for (const registered of REGISTERED) {
      const file = join(APP_ROOT, `${registered.path.replace(/^\//, '')}.tsx`)
      expect(existsSync(file), `${registered.path}.tsx não existe`).toBe(true)

      const renderer = CELL_MODULES[registered.path]?.[registered.exportName]
      expect(typeof renderer, `${registered.path}#${registered.exportName} não é um export`).toBe('function')
      expect((renderer as { name: string }).name).toBe(registered.exportName)
    }
  })
})

describe('native list configuration', () => {
  test.each(NATIVE.map((collection) => [collection.slug, collection] as const))(
    '%s lists three to five existing columns, with the title column first',
    (_slug, collection) => {
      const columns = columnsOf(collection)
      const fields = collection.fields as FieldWithAdmin[]
      const names = fields.map((field) => nameOf(collection, field))

      expect(columns.length).toBeGreaterThanOrEqual(3)
      expect(columns.length).toBeLessThanOrEqual(5)
      expect(columns.filter((column) => column !== 'id' && !names.includes(column))).toEqual([])

      // O Payload só liga o primeiro campo ativo da tabela ao documento
      // (`isLinkedColumn: colIndex === activeColumnsIndices[0]`), e uma célula
      // própria substitui o DefaultCell inteiro — inclusive o link. Por isso o
      // título tem de abrir a lista e continuar sem célula própria.
      expect(columns[0]).toBe(collection.admin?.useAsTitle)
      expect(cellOf(fields.find((field) => field.name === columns[0]) ?? {})).toBeNull()
    },
  )

  test.each(NATIVE.map((collection) => [collection.slug, collection] as const))(
    '%s declares a menu group, a description and its searchable fields',
    (_slug, collection) => {
      const groups = CMS_NAV_GROUPS.map((group) => group.label as string)

      expect(groups).toContain(collection.admin?.group)
      expect(collection.admin?.description?.length ?? 0).toBeGreaterThan(20)

      const names = (collection.fields as FieldWithAdmin[]).map((field) => nameOf(collection, field))
      expect(collection.admin?.listSearchableFields?.every((field) => names.includes(field))).toBe(true)
    },
  )

  test('the credential list keeps the field the status cell derives expiry from', () => {
    // `CredentialStatusCell` deriva `expired` de `expiresAt`: com a projeção
    // ligada, o documento chegaria sem o campo e a credencial vencida voltaria a
    // aparecer como ativa, sem erro nenhum.
    const columns = columnsOf(ConsumerCredentials)
    const projected = ConsumerCredentials.admin?.enableListViewSelectAPI === true

    expect(!projected || columns.includes('expiresAt')).toBe(true)
  })
  test('no visible label leaks internal jargon', () => {
    // Regra do usuário para esta camada: jargão interno visível é vazamento. Sem
    // `label`, o Payload humaniza o NOME do campo — então `fastapiUserId`,
    // `authzRevision` e `lastIntrospectedAt` apareceriam na UI como
    // "Fastapi User Id", "Authz Revision" e "Last Introspected At".
    const JARGON = /authz|fastapi|introspect/i

    for (const collection of NATIVE) {
      for (const field of collection.fields as FieldWithAdmin[]) {
        if (field.admin?.hidden) continue

        const visible = typeof field.label === 'string' ? field.label : (field.name ?? '')
        expect(JARGON.test(visible), `${collection.slug}.${field.name} → "${visible}"`).toBe(false)
      }
    }
  })
})

describe('write path', () => {
  test.each([ConsumerApplications, ConsumerCredentials])('$slug keeps the native write paths closed', (collection) => {
    expect(collection.access?.create?.({} as never)).toBe(false)
    expect(collection.access?.update?.({} as never)).toBe(false)
    expect(collection.access?.delete?.({} as never)).toBe(false)
    expect(collection.access?.read?.({ req: { user: { authorized: true, role: 'admin' } } } as never)).toBe(true)
    expect(collection.access?.read?.({ req: { user: { authorized: true, role: 'curator' } } } as never)).toBe(false)
  })
})
