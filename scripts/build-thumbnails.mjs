#!/usr/bin/env node
/* Build per-effect homepage poster thumbnails for wordart.
 *
 * Strategy: extract the first frame of each mp4 in assets/previews/ to a
 * PNG via ffmpeg, then convert to webp via cwebp. Posters keep card slots
 * visually present while the video lazy-loads.
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PREVIEWS = resolve(ROOT, 'assets/previews');
const OUT = resolve(ROOT, 'assets/thumbs');
const FFMPEG = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';

const ALL_EFFECTS = [
  'aurora','blur','cascade','chromatic','clutter','coil','collapse','constellation',
  'construct','cylinder','dither','glitch','halftone','interference','line','liquid',
  'mesh','noise','pixel','ribbon','ripple','slice','type','wave',
];
const skipExisting = process.argv.includes('--skip-existing');
const argEffects = process.argv.slice(2).filter(a => !a.startsWith('--'));
const EFFECTS = argEffects.length ? argEffects : ALL_EFFECTS;

function build() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  let ok = 0, missing = 0;
  for (const slug of EFFECTS) {
    const dst = resolve(OUT, `${slug}.webp`);
    if (skipExisting && existsSync(dst)) {
      console.log(`SKIP ${slug}.webp already exists`);
      ok++;
      continue;
    }
    const src = resolve(PREVIEWS, `${slug}.mp4`);
    if (!existsSync(src)) {
      console.log(`MISSING ${slug}.mp4`);
      missing++;
      continue;
    }
    // Sample at 0.5s — by then the text envelope has come up enough to read.
    const tmp = mkdtempSync(join(tmpdir(), `wa-thumb-${slug}-`));
    const png = join(tmp, 'f.png');
    try {
      const ff = spawnSync(FFMPEG, ['-y','-ss','0.5','-i', src, '-vframes','1','-vf','scale=560:-1', png], { encoding:'utf8' });
      if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr?.slice(-200)}`);
      const dst = resolve(OUT, `${slug}.webp`);
      execSync(`cwebp -quiet -q 78 ${JSON.stringify(png)} -o ${JSON.stringify(dst)}`, { stdio: 'inherit' });
      ok++;
    } catch (e) {
      console.error(`FAIL ${slug}: ${e.message}`);
    } finally {
      try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    }
  }
  console.log(`\nthumbnails: ${ok} built, ${missing} missing (of ${EFFECTS.length})`);
}

build();
