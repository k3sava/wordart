#!/usr/bin/env node
/* Build per-effect homepage video previews for wordart.
 *
 * Spec:
 *   - Skip splash via addInitScript (wa.splash.seen).
 *   - Each effect exposes window.WAEffect.renderAt(t_loop) where t_loop ∈ [0,1].
 *     Effects already loop seamlessly (text envelope = sin(π·t), other params
 *     pingpong via (1-cos)/2) — so no source crossfade is needed; the cycle
 *     itself begins and ends with empty/rest state.
 *   - 20s @ 24fps = 480 frames screenshot from #cv → ffmpeg mp4.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'assets/previews');
const BASE = process.env.WORDART_BASE || 'http://localhost:8011';

const ALL_EFFECTS = [
  'aurora','blur','cascade','chromatic','clutter','coil','collapse','constellation',
  'construct','cylinder','dither','glitch','halftone','interference','line','liquid',
  'mesh','noise','pixel','ribbon','ripple','slice','type','wave',
];
const onlyArg = process.argv.slice(2).filter(a => !a.startsWith('--'));
const skipExisting = process.argv.includes('--skip-existing');
const EFFECTS = onlyArg.length ? onlyArg : ALL_EFFECTS;

const FPS = Number(process.env.WA_FPS || 24);
const DURATION_S = Number(process.env.WA_DUR || 20);
const FRAME_COUNT = Math.round(FPS * DURATION_S);
const VIEWPORT = { width: 560, height: 360 };  // exact 280/180 ratio × 2
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

async function captureSlug(browser, slug) {
  const url = `${BASE}/${slug}/`;

  const ctx = await browser.newContext({ viewport: VIEWPORT });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wa.splash.seen', '1'); } catch {}
    // Seed a recognizable phrase so every preview shows readable type.
    try { localStorage.setItem('wa.text', 'wordart'); } catch {}
  });
  const page = await ctx.newPage();
  const tmp = mkdtempSync(join(tmpdir(), `wa-${slug}-`));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForFunction(() => !!window.WAEffect, { timeout: 10000 });

    // Hide chrome so the captured frames are pure canvas.
    await page.addStyleTag({ content: `
      .wa-top, .wg, .wa-bottom, .wa-rec, #pix-splash, #pix-nav-overlay { display: none !important; }
      body.wa-effect, .wa-stage { background: #000; }
      .wa-stage { position: fixed; inset: 0; }
      #cv { position: fixed; inset: 0; width: 100vw !important; height: 100vh !important; }
    ` });

    // Settle text + layout.
    await page.waitForTimeout(400);

    // Toggle Animate ON for any effects whose renderAt() depends on it; pause
    // the natural RAF so we drive frames deterministically.
    await page.evaluate(() => {
      const row = document.querySelector('.wg-row[data-key="animate"]');
      if (row && typeof row._write === 'function') row._write(true);
      window.WAEffect.pauseRender?.();
    });
    await page.waitForTimeout(200);

    const cv = await page.$('#cv');
    if (!cv) throw new Error('no #cv canvas');

    for (let i = 0; i < FRAME_COUNT; i++) {
      const t = i / FRAME_COUNT;
      await page.evaluate((t) => { window.WAEffect.renderAt(t); }, t);
      await cv.screenshot({ path: join(tmp, `f-${String(i).padStart(3, '0')}.png`) });
    }

    const dst = resolve(OUT, `${slug}.mp4`);
    const ff = spawnSync(FFMPEG, [
      '-y', '-framerate', String(FPS),
      '-i', join(tmp, 'f-%03d.png'),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-vf', 'scale=560:360:flags=lanczos',
      dst,
    ], { encoding: 'utf8' });
    if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr?.slice(-400)}`);
    return { ok: true, size: statSync(dst).size };
  } finally {
    await ctx.close();
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const slug of EFFECTS) {
    const dst = resolve(OUT, `${slug}.mp4`);
    if (skipExisting && existsSync(dst)) {
      console.log(`SKIP ${slug.padEnd(10)} already exists`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await Promise.race([
        captureSlug(browser, slug),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout >240s')), 240000)),
      ]);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`OK ${slug.padEnd(10)} ${(r.size/1024).toFixed(0).padStart(4)}KB  ${dt}s`);
      results.push({ slug, ...r });
    } catch (e) {
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`SKIP ${slug.padEnd(9)} ${dt}s  ${e.message}`);
      results.push({ slug, ok: false, error: e.message });
    }
  }
  await browser.close();
  const ok = results.filter(r => r.ok);
  console.log(`\nbuilt ${ok.length}/${EFFECTS.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
