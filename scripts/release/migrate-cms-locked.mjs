import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { MongoClient } from 'mongodb'

const mongoUrl = process.env.CMS_MONGODB_URL?.trim()
const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim() || 'concierge-cms'
const lockId = 'cms-schema-migrations'
const owner = randomUUID()
const leaseMs = 30 * 60 * 1_000

if (!mongoUrl) throw new Error('CMS_MONGODB_URL is required for locked migrations')

const client = new MongoClient(mongoUrl, { appName: 'concierge-cms-migration' })
await client.connect()
const locks = client.db(databaseName).collection('cms-migration-locks')

async function acquireLock() {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + leaseMs)
  try {
    const result = await locks.findOneAndUpdate(
      { _id: lockId, expiresAt: { $lte: now } },
      { $set: { owner, acquiredAt: now, expiresAt } },
      { returnDocument: 'after' },
    )
    if (result) return true
    await locks.insertOne({ _id: lockId, owner, acquiredAt: now, expiresAt })
    return true
  } catch (error) {
    if (error?.code === 11000) return false
    throw error
  }
}

async function run(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`CMS migration process failed (${signal ?? code ?? 'unknown'})`))
    })
  })
}

try {
  if (!(await acquireLock())) throw new Error('CMS migration lock is held by another release')
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  await run(npm, ['run', 'migrate:cms', '--workspace=@concierge/admin'])
} finally {
  await locks.deleteOne({ _id: lockId, owner }).catch(() => undefined)
  await client.close()
}
