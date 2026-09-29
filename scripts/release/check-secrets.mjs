import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const SECRET_PATTERNS = [
  { name: 'Google OAuth client secret', re: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/g },
  { name: 'OpenAI API key', re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'GitHub classic token', re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { name: 'GitHub fine-grained token', re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'private key material', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
]

function trackedFiles(root = ROOT) {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ls-files failed with exit code ${result.status}`)
  return result.stdout.split('\0').filter(Boolean)
}

export function findingsForText(text, file = '<text>') {
  const findings = []
  for (const { name, re } of SECRET_PATTERNS) {
    re.lastIndex = 0
    for (const match of text.matchAll(re)) {
      const before = text.slice(0, match.index)
      const line = before.split('\n').length
      findings.push({ file, line, name })
    }
  }
  return findings
}

export function scanTrackedFiles(root = ROOT) {
  const findings = []
  for (const relative of trackedFiles(root)) {
    let content
    try {
      content = readFileSync(path.join(root, relative))
    } catch {
      continue
    }
    // Binary/data assets are irrelevant to the source/config secret gate and
    // decoding them can manufacture accidental token-looking byte sequences.
    if (content.includes(0)) continue
    findings.push(...findingsForText(content.toString('utf8'), relative))
  }
  return findings
}

export function runSecretCheck(root = ROOT) {
  const findings = scanTrackedFiles(root)
  if (findings.length === 0) {
    console.log('Tracked secret scan passed.')
    return 0
  }

  console.error('Potential committed secrets detected:')
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.name}]`)
  }
  console.error('Use placeholders in tracked files and keep real values in the configured secret stores.')
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runSecretCheck()
}
