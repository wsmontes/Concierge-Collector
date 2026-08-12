#!/usr/bin/env node
/**
 * File: prod_ui_smoke.mjs
 * Purpose: Smoke test e2e da UI de PRODUÇÃO com Chrome headless (puppeteer-core).
 *          Carrega o static site real, verifica bootstrap (AppConfig, DataStore,
 *          SyncManager), health da API via fetch e captura erros de console/página.
 * Dependencies: puppeteer-core (devDependency), Google Chrome instalado.
 * Usage: node scripts/e2e/prod_ui_smoke.mjs
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.CHROME_PATH,
].filter(Boolean);

const URL = process.env.PROD_URL || 'https://concierge-collector-web.onrender.com';
const API_HEALTH = process.env.API_HEALTH_URL || 'https://concierge-collector.onrender.com/api/v3/health';

const chromePath = CHROME_PATHS.find(p => existsSync(p));
if (!chromePath) {
  console.error('Chrome não encontrado. Defina CHROME_PATH.');
  process.exit(2);
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text().slice(0, 300)}`);
});
page.on('pageerror', err => consoleErrors.push(`[pageerror] ${String(err).slice(0, 300)}`));

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await new Promise(r => setTimeout(r, 6000)); // espera bootstrap + sync inicial

const report = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  hasAppConfig: !!window.AppConfig,
  apiBase: window.AppConfig?.api?.backend?.baseUrl || null,
  dataStoreReady: !!(window.DataStore && window.DataStore.db),
  syncManagerPresent: !!window.SyncManager,
  curationBrowserPresent: !!window.CurationBrowser,
  appConfigPresent: !!window.AppConfig,
}));

const health = await page.evaluate(async (url) => {
  try {
    const r = await fetch(url);
    return { status: r.status, body: (await r.text()).slice(0, 120) };
  } catch (e) {
    return { error: String(e) };
  }
}, API_HEALTH);

const summary = {
  report,
  health,
  consoleErrors,
  passed: report.dataStoreReady && report.syncManagerPresent && health.status === 200,
};

console.log(JSON.stringify(summary, null, 2));
await browser.close();
process.exit(summary.passed && consoleErrors.length === 0 ? 0 : 1);
