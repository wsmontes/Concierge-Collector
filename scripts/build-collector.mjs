import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { TOKENS_GENERATED_PATH, checkCollectorTokens, writeCollectorTokens } from './design-tokens.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDir = join(root, 'dist', 'collector')
const inputs = ['index.html', 'images', 'scripts', 'styles']
const externalHosts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'])

async function fileManifest(directory) {
  const manifest = []
  async function walk(current) {
    for (const name of (await readdir(current)).sort()) {
      const absolute = join(current, name)
      const info = await stat(absolute)
      if (info.isDirectory()) await walk(absolute)
      else {
        const content = await readFile(absolute)
        manifest.push({ path: relative(directory, absolute), sha256: createHash('sha256').update(content).digest('hex'), size: content.length })
      }
    }
  }
  await walk(directory)
  return manifest
}

function localReference(reference) {
  if (!reference || reference.startsWith('#') || reference.startsWith('data:')) return null
  if (/^https?:\/\//i.test(reference)) {
    const url = new URL(reference)
    if (!externalHosts.has(url.hostname)) throw new Error(`Unapproved external asset host: ${url.hostname}`)
    return null
  }
  if (/^(mailto:|tel:|javascript:)/i.test(reference)) return null
  return reference.split(/[?#]/, 1)[0]
}

async function validateHtml(directory) {
  // A legacy, intentionally disabled module appears inside an HTML comment;
  // it is not a browser dependency and must not make the release fail.
  const html = (await readFile(join(directory, 'index.html'), 'utf8')).replace(/<!--[\s\S]*?-->/g, '')
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)].map((match) => localReference(match[1]))
  for (const reference of references.filter(Boolean)) {
    const absolute = resolve(directory, reference)
    if (!absolute.startsWith(`${directory}/`) || !(await stat(absolute).catch(() => null))) {
      throw new Error(`Collector output references a missing local asset: ${reference}`)
    }
  }
}

async function build(destination) {
  await rm(destination, { force: true, recursive: true })
  await mkdir(destination, { recursive: true })
  for (const input of inputs) await cp(join(root, input), join(destination, basename(input)), { recursive: true })
  await validateHtml(destination)
  const manifest = await fileManifest(destination)
  await writeFile(join(destination, '.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

// Token modes exit before any copying: they only project the shared package
// into styles/tokens.generated.css, which the full build then treats as a
// normal source file.
if (process.argv.includes('--tokens-only')) {
  const result = await writeCollectorTokens()
  console.log(`${result.changed ? 'Regenerated' : 'Already current'}: ${relative(root, result.path)}`)
} else if (process.argv.includes('--tokens-check')) {
  await checkCollectorTokens()
  console.log(`Already current: ${relative(root, TOKENS_GENERATED_PATH)}`)
} else {
  // A release must never ship a stale projection of the brand ramp.
  await checkCollectorTokens()
  const primary = await build(outputDir)
  if (process.argv.includes('--check')) {
    const temporary = await mkdtemp(join(tmpdir(), 'concierge-collector-build-'))
    try {
      const secondary = await build(join(temporary, 'collector'))
      if (JSON.stringify(primary) !== JSON.stringify(secondary)) throw new Error('Collector build is not deterministic')
    } finally {
      await rm(temporary, { force: true, recursive: true })
    }
  }
}
