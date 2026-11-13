// Load time on a throttled phone profile: 4x slower CPU, local server. Prints numbers, no pass/fail.
import { serve, launch, newPage } from './harness.mjs';
const { server, url } = await serve(); const browser = await launch();
for (const mode of ['live', 'demo']) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const { page, context } = await newPage(browser, { width: 390, height: 844, touch: true, init: mode === 'demo' ? () => localStorage.setItem('cala_mode', 'demo') : undefined });
    const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const bytes = { js: 0, css: 0 }; page.on('response', async r => { try { const u = r.url(); if (!u.startsWith(url)) return; const b = (await r.body()).length; if (/\.js$/.test(u)) bytes.js += b; if (/\.css$/.test(u)) bytes.css += b; } catch { } });
    const t0 = Date.now(); await page.goto(url); await page.waitForSelector('#quest-board .quest-card'); const t1 = Date.now() - t0;
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), nodes: document.getElementsByTagName('*').length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10 : null }; });
    const st = await page.evaluate(() => (localStorage.getItem('cala_state_v2') || localStorage.getItem('cala_state_demo_v1') || '').length);
    runs.push({ questBoardMs: t1, ...m, jsKB: Math.round(bytes.js / 1024), cssKB: Math.round(bytes.css / 1024), stateKB: Math.round(st / 102.4) / 10 });
    await context.close();
  }
  console.log(mode, JSON.stringify(runs));
}
await browser.close(); server.close();
