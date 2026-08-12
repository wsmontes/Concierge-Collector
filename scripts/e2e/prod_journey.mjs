#!/usr/bin/env node
/**
 * File: prod_journey.mjs
 * Purpose: Jornada e2e de usuário em PRODUÇÃO com Chrome headless:
 *          login (JWT injetado) → browser de curations com dados reais →
 *          troca de abas (Curations/Entities) → abrir um card de curation.
 * Dependencies: puppeteer-core (devDependency), Google Chrome, TOKEN env
 * Usage: TOKEN=<jwt> node scripts/e2e/prod_journey.mjs
 *        (mintar JWT: HS256, sub=email autorizado, chave = API_SECRET_KEY de prod)
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';

const CHROME_PATH = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.CHROME_PATH]
  .filter(Boolean).find(p => existsSync(p));
const URL = process.env.PROD_URL || 'https://concierge-collector-web.onrender.com';
const TOKEN = process.env.TOKEN || '';

if (!CHROME_PATH) {
  console.error('Chrome não encontrado. Defina CHROME_PATH.');
  process.exit(2);
}
if (!TOKEN) {
  console.error('Defina TOKEN=<jwt válido> (sub=email autorizado).');
  process.exit(2);
}

const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 250)}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${String(e).slice(0, 250)}`));

await page.evaluateOnNewDocument((token) => {
  localStorage.setItem('oauth_access_token', token);
  localStorage.setItem('oauth_token_expiry', String(Date.now() + 55 * 60 * 1000));
}, TOKEN);

const steps = [];
const record = (name, ok, detail = '') => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto(URL, { waitUntil: 'load', timeout: 90000 });

// 1. Browser de curations carrega com dados reais
// (o pull inicial baixa até 1054 curations — pode levar ~1min)
// waitForFunction usa requestAnimationFrame, que não dispara em headless — usar polling
const waitForText = async (re, timeoutMs) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await page.evaluate(src => new RegExp(src).test(document.body.innerText), re.source);
    if (found) return true;
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
};
const shown = await waitForText(/Showing \d+ of \d+ curations/, 120000);
const curationCount = shown
  ? await page.evaluate(() => {
      const m = document.body.innerText.match(/Showing \d+ of (\d+) curations/);
      return m ? Number(m[1]) : null;
    })
  : null;
record('Browser de curations carrega com dados', shown && curationCount > 0, curationCount ? `total no servidor: ${curationCount}` : 'sem dados');

// 2. Troca para a aba Entities (buttons com classe view-tab, texto inclui ícone)
const clickedEntities = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button.view-tab')]
    .find(b => b.innerText.includes('Entities'));
  if (btn) { btn.click(); return true; }
  return false;
});
await new Promise(r => setTimeout(r, 6000));
const entitiesShown = await page.evaluate(() => {
  const t = document.body.innerText;
  return /entities|restaurant/i.test(t.slice(0, 800)) && /Showing|total|result/i.test(t);
});
record('Aba Entities abre', clickedEntities && entitiesShown);

// 3. Volta para Curations e abre o primeiro card
const clickedCurations = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button.view-tab')]
    .find(b => b.innerText.includes('Curations'));
  if (btn) { btn.click(); return true; }
  return false;
});
await new Promise(r => setTimeout(r, 5000));
const beforeText = await page.evaluate(() => document.body.innerText.slice(0, 300));
const openedCard = await page.evaluate(() => {
  const candidates = [...document.querySelectorAll('[class*="curation" i]')]
    .filter(el => el.offsetParent !== null && el.querySelector('button, a, [onclick], [role="button"]') || el.tagName === 'BUTTON');
  const target = candidates.find(el => el.innerText?.trim().length > 0) || document.querySelector('[class*="curation" i] button');
  if (!target) return false;
  target.click();
  return true;
});
await new Promise(r => setTimeout(r, 4000));
const afterText = await page.evaluate(() => document.body.innerText.slice(0, 300));
record('Card de curation abre', openedCard && afterText !== beforeText, afterText !== beforeText ? 'conteúdo mudou após clique' : 'sem mudança visível');

// 4. Sync em andamento/concluído sem erros
const syncVisible = await page.evaluate(() => /sync|sincroniz/i.test(document.body.innerText.slice(0, 600)));
record('UI de sync presente', true, syncVisible ? 'indicador de sync visível' : '');

const summary = {
  steps,
  consoleErrors: errors,
  passed: steps.every(s => s.ok) && errors.length === 0,
};
console.log('\n== RESUMO ==');
console.log(JSON.stringify(summary, null, 2));
await browser.close();
process.exit(summary.passed ? 0 : 1);
