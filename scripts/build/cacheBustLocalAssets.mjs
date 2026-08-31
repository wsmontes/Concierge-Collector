import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'

const ATTR_RE = /\b(src|href)=(['"])([^'"\n\r]+)\2/gi

function isSkippable(reference) {
  if (!reference) return true
  const value = reference.trim()
  return value.startsWith('#') ||
    value.startsWith('data:') ||
    /^(https?:|mailto:|tel:|javascript:)/i.test(value)
}

function splitReference(reference) {
  const hashIndex = reference.indexOf('#')
  const fragment = hashIndex >= 0 ? reference.slice(hashIndex) : ''
  const withoutFragment = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference
  const queryIndex = withoutFragment.indexOf('?')
  return {
    pathname: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    query: queryIndex >= 0 ? withoutFragment.slice(queryIndex + 1) : '',
    fragment
  }
}

function isInsideRoot(root, absolute) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`
  return absolute === root || absolute.startsWith(normalizedRoot)
}

async function fileHash(absolute) {
  const content = await readFile(absolute)
  return createHash('sha256').update(content).digest('hex').slice(0, 12)
}

function withVersion(pathname, query, fragment, version) {
  const params = new URLSearchParams(query)
  params.set('v', version)
  const serialized = params.toString()
  return `${pathname}${serialized ? `?${serialized}` : ''}${fragment}`
}

/**
 * Rewrite local src/href references in a built Collector index.html so their
 * `v=` parameter is derived from the referenced file contents.
 *
 * The source index may keep human-readable/manual versions for development;
 * production output never relies on them. External/data/navigation URLs are
 * untouched. Re-running on identical files is byte-for-byte deterministic.
 */
export async function stampLocalAssetVersions(directory) {
  const root = resolve(directory)
  const indexPath = resolve(root, 'index.html')
  const original = await readFile(indexPath, 'utf8')
  const replacements = []

  for (const match of original.matchAll(ATTR_RE)) {
    const [full, attribute, quote, reference] = match
    if (isSkippable(reference)) continue

    const { pathname, query, fragment } = splitReference(reference)
    if (!pathname) continue

    const absolute = resolve(root, pathname)
    if (!isInsideRoot(root, absolute)) continue

    let version
    try {
      version = await fileHash(absolute)
    } catch (_) {
      // validateHtml owns the missing-file error. Do not hide or transform the
      // reference here merely because it cannot be hashed.
      continue
    }

    const stampedReference = withVersion(pathname, query, fragment, version)
    if (stampedReference === reference) continue
    replacements.push({
      start: match.index,
      end: match.index + full.length,
      value: `${attribute}=${quote}${stampedReference}${quote}`
    })
  }

  if (!replacements.length) return false

  let stamped = original
  for (const replacement of replacements.reverse()) {
    stamped = `${stamped.slice(0, replacement.start)}${replacement.value}${stamped.slice(replacement.end)}`
  }

  if (stamped === original) return false
  await writeFile(indexPath, stamped)
  return true
}
