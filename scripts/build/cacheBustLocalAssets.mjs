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

/**
 * Compute one build-generation identity from the pristine copied shell.
 *
 * Dynamic JS loaders cannot safely use their target's final content hash:
 * loaders themselves are rewritten, and loader graphs may be cyclic. A single
 * source-generation hash is deterministic, cycle-free, and changes whenever
 * any shipped source byte/path changes. Static index.html references are still
 * stamped later with the FINAL content hash of their target files.
 */
export async function computeShellGeneration(directory) {
  const root = resolve(directory)
  const digest = createHash('sha256')
  const files = await listFiles(root)
  for (const absolute of files) {
    const path = relative(root, absolute).replaceAll(sep, '/')
    if (path === '.manifest.json') continue
    digest.update(path)
    digest.update('\0')
    digest.update(await readFile(absolute))
    digest.update('\0')
  }
  return digest.digest('hex').slice(0, 12)
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

async function generationStampedScriptReference(root, reference, generation) {
  if (isSkippable(reference)) return reference
  const { pathname, query, fragment } = splitReference(reference)
  if (!pathname) return reference
  const absolute = resolve(root, pathname)
  if (!isInsideRoot(root, absolute)) return reference
  try {
    const info = await stat(absolute)
    if (!info.isFile()) return reference
  } catch (_) {
    return reference
  }
  return withVersion(pathname, query, fragment, generation)
}

/**
 * Rewrite local src/href references in the built Collector index.html so their
 * `v=` parameter is derived from the FINAL referenced file contents.
 *
 * Call this after dynamic JS stamping; otherwise a loader changed later in the
 * build would leave index.html pointing at a pre-rewrite hash.
 */
export async function stampLocalAssetVersions(directory) {
  const root = resolve(directory)
  const indexPath = resolve(root, 'index.html')
  const original = await readFile(indexPath, 'utf8')
  const replacements = []

  for (const match of original.matchAll(ATTR_RE)) {
    const [full, attribute, quote, reference] = match
    const versioned = await stampedReference(root, reference)
    if (versioned === reference) continue
    replacements.push({
      start: match.index,
      end: match.index + full.length,
      value: `${attribute}=${quote}${versioned}${quote}`
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
 * Stamp quoted same-origin `scripts/*.js` references used by legacy dynamic
 * loaders with one immutable shell-generation id. This avoids recursive
 * content-hash dependencies between loaders while still invalidating every
 * dynamic URL whenever any shipped shell source changes.
 */
export async function stampLocalScriptVersions(directory, generation) {
  if (!/^[a-f0-9]{12}$/i.test(String(generation || ''))) {
    throw new Error('stampLocalScriptVersions requires a 12-character shell generation')
  }

  const root = resolve(directory)
  const files = (await listFiles(root)).filter((absolute) => absolute.endsWith('.js'))
  let changed = 0

  for (const absolute of files) {
    const original = await readFile(absolute, 'utf8')
    const replacements = []

    for (const match of original.matchAll(QUOTED_LOCAL_SCRIPT_RE)) {
      const [full, quote, reference] = match
      const versioned = await generationStampedScriptReference(root, reference, generation)
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
 * Replace the Service Worker/cache-generation placeholder with the generation
 * computed from the pristine copied shell. The same generation is also used by
 * dynamic loaders, so the SW can precache those exact aliases without any
 * recursive file-hash dependency.
 */
export async function stampServiceWorkerGeneration(directory, generation) {
  if (!/^[a-f0-9]{12}$/i.test(String(generation || ''))) {
    throw new Error('stampServiceWorkerGeneration requires a 12-character shell generation')
  }

  const root = resolve(directory)
  const swPath = resolve(root, 'service-worker.js')
  const source = await readFile(swPath, 'utf8')
  if (!source.includes(SW_VERSION_PLACEHOLDER)) {
    // Idempotent re-application with the same generation is allowed.
    if (source.includes(generation)) return generation
    throw new Error(`service-worker.js is missing ${SW_VERSION_PLACEHOLDER}`)
  }

  await writeFile(swPath, source.replaceAll(SW_VERSION_PLACEHOLDER, generation))
  return generation
}
