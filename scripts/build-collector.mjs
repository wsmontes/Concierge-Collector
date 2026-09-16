import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { ADMIN_TOKENS_GENERATED_PATH, TOKENS_GENERATED_PATH, checkDesignTokens, writeDesignTokens } from './design-tokens.mjs'
import {
  computeShellGeneration,
  stampLocalAssetVersions,
  stampLocalScriptVersions,
  stampServiceWorkerGeneration,
} from './build/cacheBustLocalAssets.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDir = join(root, 'dist', 'collector')
// `capture` entra porque /capture/ é servido na MESMA origem do Collector e é
// um app funcional (o static site o serve hoje). Sem ele no artefato, trocar o
// publishPath para dist/collector derrubaria a rota — regressão silenciosa
// numa feature que funciona.
const inputs = ['index.html', 'service-worker.js', 'images', 'scripts', 'styles', 'capture']
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

  // Loaders dinâmicos: módulos injetados por `script.src = '...'` não passam
  // pelo index.html, então uma remoção errada (ou um typo no caminho) só
  // apareceria em runtime — em geral quando o app já está offline e sem como
  // buscar o arquivo. O guard vale sobretudo porque o build agora poda
  // ferramentas de repositório do artefato.
  const dynamicRefs = new Set()
  async function collectScriptRefs(current) {
    for (const name of await readdir(current)) {
      const absolute = join(current, name)
      const info = await stat(absolute)
      if (info.isDirectory()) {
        await collectScriptRefs(absolute)
      } else if (name.endsWith('.js')) {
        const source = await readFile(absolute, 'utf8')
        for (const match of source.matchAll(/['"](scripts\/[A-Za-z0-9_./-]+\.js)(?:\?[^'"]*)?['"]/g)) {
          dynamicRefs.add(match[1])
        }
      }
    }
  }
  await collectScriptRefs(directory)
  for (const reference of dynamicRefs) {
    if (!(await stat(resolve(directory, reference)).catch(() => null))) {
      throw new Error(`Collector output references a missing dynamically loaded script: ${reference}`)
    }
  }
}

// Ferramentas de repositório que NÃO são carregadas pelo navegador. Ficam fora
// do artefato publicado por dois motivos: peso (python-tools sozinho é 81
// arquivos) e exposição — o static site é público e servia, por exemplo,
// `scripts/python-tools/mongo_tools.py` (lê o .env com credenciais do Atlas) e
// `data_cleanup.py` (destrutivo). Verificado: a página só referencia
// scripts/{auth,core,managers,modules,services,storage,sync,ui,ui-core,utils}.
const excludedFromArtifact = [
  /^scripts\/(python-tools|release|build|operations|e2e)\//,
  /(^|\/)(__pycache__|\.pytest_cache|node_modules)\//,
  /\.(py|pyc|pyo|mjs)$/,
  /\.md$/,
  /^scripts\/(build-collector\.mjs|design-tokens\.mjs)$/
]

async function pruneArtifact(directory) {
  async function walk(current) {
    for (const name of await readdir(current)) {
      const absolute = join(current, name)
      const rel = relative(directory, absolute)
      const info = await stat(absolute)
      if (info.isDirectory()) {
        if (excludedFromArtifact.some((re) => re.test(`${rel}/`))) {
          await rm(absolute, { force: true, recursive: true })
        } else {
          await walk(absolute)
        }
      } else if (excludedFromArtifact.some((re) => re.test(rel))) {
        await rm(absolute, { force: true })
      }
    }
  }
  await walk(directory)
}

async function build(destination) {
  await rm(destination, { force: true, recursive: true })
  await mkdir(destination, { recursive: true })
  for (const input of inputs) await cp(join(root, input), join(destination, basename(input)), { recursive: true })

  // Antes de gerar o manifest: o que não é publicado não deve entrar no hash da
  // geração do shell nem ser precacheado pelo service worker.
  await pruneArtifact(destination)

  // One generation is computed from the pristine copied shell. Dynamic loader
  // graphs use that stable generation (no recursive content-hash dependency).
  // Once those JS bytes are final, index.html receives exact final-file hashes.
  // The Service Worker uses the same generation and precaches both identities.
  const shellGeneration = await computeShellGeneration(destination)
  await stampLocalScriptVersions(destination, shellGeneration)
  await stampLocalAssetVersions(destination)
  await stampServiceWorkerGeneration(destination, shellGeneration)
  await validateHtml(destination)

  const manifest = await fileManifest(destination)
  await writeFile(join(destination, '.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

// Token modes exit before any copying: they only project the shared package
// into styles/tokens.generated.css, which the full build then treats as a
// normal source file.
if (process.argv.includes('--tokens-only')) {
  const result = await writeDesignTokens()
  const paths = [TOKENS_GENERATED_PATH, ADMIN_TOKENS_GENERATED_PATH].map((p) => relative(root, p))
  console.log(result.changed.length === 0
    ? `Already current: ${paths.join(', ')}`
    : `Regenerated: ${result.changed.join(', ')}`)
} else if (process.argv.includes('--tokens-check')) {
  await checkDesignTokens()
  console.log(`Already current: ${relative(root, TOKENS_GENERATED_PATH)}, ${relative(root, ADMIN_TOKENS_GENERATED_PATH)}`)
} else {
  // A release must never ship a stale projection of the brand ramp — neither the
  // Collector's plain copy nor the Admin's pixel-resolved one.
  await checkDesignTokens()
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
