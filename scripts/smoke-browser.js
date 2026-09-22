#!/usr/bin/env bun
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const fixture = join(root, 'prototype/stress/models/lowledge.stl');
const downloads = join(root, 'tmp/smoke-downloads');
rmSync(downloads, { recursive: true, force: true });
mkdirSync(downloads, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', host], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
server.stderr.on('data', (b) => { stderr += b; });

async function waitForServer() {
  const url = `http://${host}:${port}/web/index.html`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return url;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start: ${stderr}`);
}

let browser;
try {
  const url = await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  await page.addInitScript(() => {
    window.__supportFinsDownloads = [];
    const originalCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = originalCreate(blob);
      window.__lastSupportFinsBlob = { url, size: blob.size, type: blob.type };
      return url;
    };
    document.addEventListener('click', (ev) => {
      const a = ev.target?.closest?.('a[download]');
      if (!a) return;
      window.__supportFinsDownloads.push({
        filename: a.download,
        href: a.href,
        blob: window.__lastSupportFinsBlob ?? null,
      });
      ev.preventDefault();
    }, true);
  });
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#file').setInputFiles(fixture);
  await page.locator('#stats').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#fins-toggle').click();
  await page.locator('#fin-opts').waitFor({ state: 'visible', timeout: 5000 });

  // Wait for either a visible audit or a fin readout after the worker/inline build lands.
  await page.waitForFunction(() => {
    const audit = document.querySelector('#s-audit')?.textContent?.trim();
    const fins = document.querySelector('#s-fins')?.textContent?.trim();
    return !!audit || (!!fins && fins !== '—');
  }, { timeout: 15000 });

  page.on('dialog', async (dialog) => {
    errors.push(`unexpected dialog: ${dialog.message()}`);
    await dialog.dismiss();
  });
  for (const id of ['export-part', 'export-part-3mf', 'export-supports', 'export-supports-3mf']) {
    await page.evaluate((buttonId) => document.getElementById(buttonId)?.click(), id);
  }
  const captured = await page.evaluate(() => window.__supportFinsDownloads);
  const expected = ['lowledge-part.stl', 'lowledge-part.3mf', 'lowledge-supports.stl', 'lowledge-supports.3mf'];
  for (const name of expected) {
    const hit = captured.find((d) => d.filename === name);
    if (!hit) throw new Error(`missing download ${name}; captured ${captured.map((d) => d.filename).join(', ')}`);
    if (!hit.blob || hit.blob.size <= 0) throw new Error(`download ${name} had no captured blob size`);
  }

  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ ok: true, fixture, downloads: captured }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
