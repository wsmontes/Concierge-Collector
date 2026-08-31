import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, resolve, sep } from 'node:path'

const ATTR_RE = /\b(src|href)=(['"])([^'"\n\r]+)\2/gi
const QUOTED_LOCAL_SCRIPT_RE = /(['"])((?:\.{0,2}\/)?scripts\/[^'"\n\r]+?\.js(?:\?[^'"\n\r#]*)?(?:#[^'"\n\r]*)?)\1/g
const SW_VERSION_PLACEHOLDER = '__COLLECTOR_SHELL_VERSION__'

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

async function listFiles(directory) {
  const root = resolve(directory)
  const files = []

  async function walk(current) {
    for (const name of (await readdir(current)).sort()) {
      const absolute = join(current, name)
      const info = await stat(absolute)
      if (info.isDirectory()) await walk(absolute)
      else files.push(absolute)
    }
  }

  await walk(root)
  return files
}

async function stampedReference(root, reference) {
  if (isSkippable(reference)) return reference
  const { pathname, query, fragment } = splitReference(reference)
  if (!pathname) return reference

  const absolute = resolve(root, pathname)
  if (!isInsideRoot(root, absolute)) return reference

  try {
    const version = await fileHash(absolute)
    return withVersion(pathname, query, fragment, version)
  } catch (_) {
    // validateHtml owns missing-file failures. Keep the original reference so
    // the later validation reports the useful path instead of hiding it here.
    return reference
  }
}

/**
 * Rewrite local src/href references in a built Collector index.html so their
 * `v=` parameter is derived from the referenced file contents.
 */
export async function stampLocalAssetVersions(directory) {
  const root = resolve(directory)
  const indexPath = resolve(root, 'index.html')
  const original = await readFile(indexPath, 'utf8')
  const replacements = []

  for (const match of original.matchAll(ATTR_RE)) {
    const [full, attribute, quote, reference] = match
    const stampedReference = await stampedReference(root, reference)
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

/**
 * Content-address quoted same-origin `scripts/*.js` references used by the
 * legacy dynamic loaders. These references are invisible to index.html's
 * src/href pass but must have the same exact-URL cache identity.
 */
export async function stampLocalScriptVersions(directory) {
  const root = resolve(directory)
  const files = (await listFiles(root)).filter((absolute) => absolute.endsWith('.js'))
  let changed = 0

  for (const absolute of files) {
    const original = await readFile(absolute, 'utf8')
    const replacements = []

    for (const match of original.matchAll(QUOTED_LOCAL_SCRIPT_RE)) {
      const [full, quote, reference] = match
      const versioned = await stampedReference(root, reference)
      if (versioned === reference) continue
      replacements.push({
        start: match.index,
        end: match.index + full.length,
        value: `${quote}${versioned}${quote}`
      })
    }

    if (!replacements.length) continue
    let stamped = original
    for (const replacement of replacements.reverse()) {
      stamped = `${stamped.slice(0, replacement.start)}${replacement.value}${stamped.slice(replacement.end)}`
    }
    if (stamped !== original) {
      await writeFile(absolute, stamped)
      changed += 1
    }
  }

  return changed
}

/**
 * Replace the Service Worker cache-generation placeholder with a deterministic
 * hash of every other shipped local file. Excluding the Service Worker itself
 * avoids a recursive hash while still rotating the worker whenever the shell
 * it controls changes.
 */
export async function stampServiceWorkerGeneration(directory) {
  const root = resolve(directory)
  const swPath = resolve(root, 'service-worker.js')
  const source = await readFile(swPath, 'utf8')
  if (!source.includes(SW_VERSION_PLACEHOLDER)) {
    throw new Error(`service-worker.js is missing ${SW_VERSION_PLACEHOLDER}`)
  }

  const digest = createHash('sha256')
  const files = await listFiles(root)
  for (const absolute of files) {
    const path = relative(root, absolute).replaceAll(sep, '/')
    if (path === 'service-worker.js' || path === '.manifest.json') continue
    digest.update(path)
    digest.update('\0')
    digest.update(await readFile(absolute))
    digest.update('\0')
  }

  const version = digest.digest('hex').slice(0, 12)
  await writeFile(swPath, source.replaceAll(SW_VERSION_PLACEHOLDER, version))
  return version
}
