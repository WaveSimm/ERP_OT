#!/usr/bin/env node
/**
 * Cleanup script for docs/.pdca-status.json
 *
 * Background:
 *   bkit Vibecoding Kit's PDCA hook auto-creates `history` entries on every
 *   file edit, treating path segments (web/[id]/ui/scripts/application/...)
 *   as feature names. bkit's lib code caps history at 100 entries, but the
 *   hook bypasses that cap → the file grows ~46 fake entries/day.
 *
 *   bkit code reads features object but NEVER reads history (verified). So
 *   filtering history to real-feature entries is safe and aligns with bkit's
 *   intended 100-cap design.
 *
 * What this script does:
 *   1. Build whitelist of real features from docs/01-plan/features/*.plan.md
 *   2. Filter `features` object: drop keys not in whitelist (path tokens)
 *   3. Filter `history` array: drop entries whose feature is not in whitelist
 *   4. Sync `activeFeatures` = sorted Object.keys(features)
 *   5. Save with timestamped backup
 *
 * Usage:  node scripts/cleanup-pdca-status.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STATUS_PATH = path.join(ROOT, 'docs', '.pdca-status.json');
const PLAN_DIR = path.join(ROOT, 'docs', '01-plan', 'features');

const dryRun = process.argv.includes('--dry-run');

function buildWhitelist() {
  if (!fs.existsSync(PLAN_DIR)) return new Set();
  const files = fs.readdirSync(PLAN_DIR);
  const set = new Set();
  for (const f of files) {
    const m = f.match(/^(.+)\.plan\.md$/);
    if (m) set.add(m[1]);
  }
  return set;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function main() {
  const whitelist = buildWhitelist();
  if (whitelist.size === 0) {
    console.error('No plan files found under', PLAN_DIR);
    process.exit(1);
  }

  const status = JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));

  // Backup
  const backupPath = STATUS_PATH + '.bak.' + timestamp();
  if (!dryRun) {
    fs.copyFileSync(STATUS_PATH, backupPath);
  }

  const beforeFeatures = Object.keys(status.features || {});
  const beforeHistory = (status.history || []).length;
  const beforeSize = fs.statSync(STATUS_PATH).size;

  // 1. Filter features
  const droppedFeatures = [];
  const keptFeatures = {};
  for (const k of beforeFeatures) {
    if (whitelist.has(k)) {
      keptFeatures[k] = status.features[k];
    } else {
      droppedFeatures.push(k);
    }
  }
  status.features = keptFeatures;

  // 2. Filter history
  const beforeHist = status.history || [];
  const keptHist = beforeHist.filter(h => h && whitelist.has(h.feature));
  const droppedHist = beforeHist.length - keptHist.length;
  status.history = keptHist;

  // 3. Sync activeFeatures
  status.activeFeatures = Object.keys(status.features).sort();

  // 4. Reset primaryFeature if it points to a dropped (path-token) feature
  let primaryFixed = false;
  if (status.primaryFeature && !whitelist.has(status.primaryFeature)) {
    primaryFixed = true;
    status.primaryFeature = null;
  }

  status.lastUpdated = new Date().toISOString();

  // Save
  if (!dryRun) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  }
  const afterSize = dryRun ? null : fs.statSync(STATUS_PATH).size;

  // Report
  console.log('=== PDCA status cleanup ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLIED');
  console.log('Whitelist size:', whitelist.size);
  console.log('Features:', beforeFeatures.length, '->', Object.keys(status.features).length,
              '(dropped ' + droppedFeatures.length + (droppedFeatures.length ? ': ' + droppedFeatures.join(', ') : '') + ')');
  console.log('History:', beforeHistory, '->', keptHist.length, '(dropped ' + droppedHist + ')');
  console.log('activeFeatures:', status.activeFeatures.length);
  console.log('primaryFeature:', primaryFixed ? '(reset to null — was pointing to path token)' : 'unchanged (' + status.primaryFeature + ')');
  console.log('File size:', beforeSize, 'bytes' + (afterSize !== null ? ' -> ' + afterSize + ' bytes (' + Math.round((1 - afterSize/beforeSize) * 100) + '% smaller)' : ''));
  if (!dryRun) console.log('Backup:', backupPath);
}

main();
