#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizeDigest } from './materialize-render-blueprint.mjs'

const RENDER_API = 'https://api.render.com/v1'
const FAILURE_STATUSES = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated'])

export function imageReference(kind, digest) {
  const normalized = normalizeDigest(digest)
  if (kind === 'api') return `ghcr.io/wsmontes/concierge-api@${normalized}`
  if (kind === 'admin') return `ghcr.io/wsmontes/concierge-admin@${normalized}`
  throw new Error(`Unknown image kind: ${kind}`)
}

/** Kept as a pure helper for emergency/manual hook use; the CLI uses the API so it can track deploy IDs. */
export function buildDeployHookUrl(hookUrl, imageUrl) {
  const url = new URL(hookUrl)
  url.searchParams.set('imgURL', imageUrl)
  return url.toString()
}

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function arg(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function renderRequest(token, path, init = {}) {
  const response = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`Render API ${response.status} for ${init.method ?? 'GET'} ${path}`)
  }
  return body
}

async function currentDeploy(token, serviceId) {
  const rows = await renderRequest(token, `/services/${encodeURIComponent(serviceId)}/deploys?limit=1`)
  const first = Array.isArray(rows) ? rows[0] : null
  const deploy = first?.deploy ?? first
  return deploy && typeof deploy.id === 'string' ? deploy : null
}

async function triggerImageDeploy(token, serviceId, imageUrl) {
  const response = await renderRequest(token, `/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ imageUrl }),
  })
  const deploy = response?.deploy ?? response
  if (!deploy || typeof deploy.id !== 'string') {
    throw new Error(`Render did not return a deploy id for ${serviceId}; refusing to continue blindly`)
  }
  return deploy.id
}

async function waitForDeploy(token, serviceId, deployId, timeoutMs = 20 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await renderRequest(
      token,
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`,
    )
    const deploy = response?.deploy ?? response
    const status = String(deploy?.status ?? '')
    if (status === 'live') return deploy
    if (FAILURE_STATUSES.has(status) || status.endsWith('_failed')) {
      throw new Error(`Render deploy ${deployId} failed with status=${status}`)
    }
    await sleep(5_000)
  }
  throw new Error(`Timed out waiting for Render deploy ${deployId}`)
}

async function waitForHttpReady(url, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual', cache: 'no-store' })
      if (response.status >= 200 && response.status < 400) return
    } catch {
      // Deployment may still be switching traffic; retry until the deadline.
    }
    await sleep(5_000)
  }
  throw new Error(`Timed out waiting for readiness endpoint: ${new URL(url).origin}`)
}

async function promoteService({ token, serviceId, imageUrl, readyUrl, label }) {
  const previous = await currentDeploy(token, serviceId)
  process.stdout.write(`${label}: triggering immutable image deploy\n`)
  const deployId = await triggerImageDeploy(token, serviceId, imageUrl)
  await waitForDeploy(token, serviceId, deployId)
  if (readyUrl) await waitForHttpReady(readyUrl)
  process.stdout.write(`${label}: deploy ${deployId} is live and ready\n`)
  return { serviceId, deployId, previousDeployId: previous?.id ?? null, imageUrl }
}

export async function promote({
  apiDigest,
  adminDigest,
  token,
  apiServiceId,
  adminServiceId,
  workerServiceId,
  apiReadyUrl,
  adminReadyUrl,
  workerReadyUrl,
}) {
  const apiImage = imageReference('api', apiDigest)
  const adminImage = imageReference('admin', adminDigest)
  const records = []

  records.push(await promoteService({
    token, serviceId: apiServiceId, imageUrl: apiImage, readyUrl: apiReadyUrl, label: 'API',
  }))
  records.push(await promoteService({
    token, serviceId: adminServiceId, imageUrl: adminImage, readyUrl: adminReadyUrl, label: 'Admin',
  }))
  records.push(await promoteService({
    token, serviceId: workerServiceId, imageUrl: adminImage, readyUrl: workerReadyUrl, label: 'Worker',
  }))
  return records
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const environment = arg('--environment') ?? 'staging'
  if (!['staging', 'production'].includes(environment)) throw new Error('--environment must be staging or production')

  const apiDigest = arg('--api-digest')
  const adminDigest = arg('--admin-digest')
  const token = required('RENDER_API_TOKEN')
  const records = await promote({
    apiDigest,
    adminDigest,
    token,
    apiServiceId: required('RENDER_API_SERVICE_ID'),
    adminServiceId: required('RENDER_ADMIN_SERVICE_ID'),
    workerServiceId: required('RENDER_WORKER_SERVICE_ID'),
    apiReadyUrl: required('RENDER_API_READY_URL'),
    adminReadyUrl: required('RENDER_ADMIN_READY_URL'),
    workerReadyUrl: required('RENDER_WORKER_READY_URL'),
  })

  const output = arg('--receipt') ?? `docs/evidence/render-${environment}-promotion.json`
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify({
    environment,
    promotedAt: new Date().toISOString(),
    apiDigest: normalizeDigest(apiDigest),
    adminDigest: normalizeDigest(adminDigest),
    services: records,
  }, null, 2)}\n`, 'utf8')
  process.stdout.write(`promotion receipt written to ${output}\n`)
}
