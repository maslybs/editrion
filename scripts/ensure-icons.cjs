#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const iconsDir = path.resolve(__dirname, '..', 'src-tauri', 'icons');
const srcPng = path.join(iconsDir, 'icon.png');

const requiredPngSizes = [32, 128, 256, 512, 1024];

function exists(p) {
  try { fs.accessSync(p, fs.constants.R_OK); return true; } catch { return false; }
}

function haveAllIcons() {
  const haveIcns = exists(path.join(iconsDir, 'icon.icns'));
  const haveIco = exists(path.join(iconsDir, 'icon.ico'));
  const havePngs = requiredPngSizes.every(s => exists(path.join(iconsDir, `${s}x${s}.png`)));
  return haveIcns && haveIco && havePngs;
}

if (!exists(srcPng)) {
  console.warn(`[ensure-icons] Skipping: source not found: ${srcPng}`);
  process.exit(0);
}

if (haveAllIcons()) {
  console.log('[ensure-icons] All platform icons present.');
  process.exit(0);
}

console.log('[ensure-icons] Missing icons detected. Generating with Tauri CLI...');
try {
  execSync(`tauri icon ${JSON.stringify(srcPng)}`, { stdio: 'inherit' });
  console.log('[ensure-icons] Done.');
} catch (e) {
  console.error('[ensure-icons] Failed to generate icons via Tauri CLI.', e?.message || e);
  process.exit(1);
}

