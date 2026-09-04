function disposableCmsDatabase(): boolean {
  const databaseName = process.env.CMS_MONGODB_DB_NAME?.trim() || 'concierge-cms'
  return databaseName.endsWith('-test') && !/prod(?:uction)?/i.test(databaseName)
}

/**
 * Reads a retention/window integer while protecting production evidence.
 *
 * The supplied fallback is also the production minimum. Disposable `*-test`
 * databases may deliberately shorten the window for staging qualification;
 * every other database may only keep the default or lengthen it. Invalid
 * configured values fail closed instead of silently changing policy.
 */
export function readRetentionInt(name: string, productionMinimum: number): number {
  if (!Number.isInteger(productionMinimum) || productionMinimum <= 0) {
    throw new Error(`Invalid production minimum for ${name}`)
  }

  const raw = process.env[name]?.trim()
  if (!raw) return productionMinimum

  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  if (value < productionMinimum && !disposableCmsDatabase()) {
    throw new Error(`${name} cannot be lower than production minimum ${productionMinimum}`)
  }
  return value
}
