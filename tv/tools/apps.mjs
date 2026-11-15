#!/usr/bin/env node
// Overview and cleanup of the apps on the TV over sdb (the restricted `sdb shell 0 <cmd>` channel).
//   node tv/tools/apps.mjs list                  every launcher app with install date, use count, duplicates marked
//   node tv/tools/apps.mjs remove <id>... [--yes] uninstall by Tizen id; without --yes it only shows what it would do
// vd_appuninstall wants the package id (the part before the dot), not the app id; the script looks it up.
// The TV records no last-started date, only use_count. SDB env var overrides the sdb path.
import { execFileSync } from 'node:child_process';

const SDB = process.env.SDB || `${process.env.HOME}/tizen-studio/tools/sdb`;
const sdb = (...a) => execFileSync(SDB, ['shell', '0', ...a], { encoding: 'utf8' }).replace(/\r/g, '');

function installed() {
  const apps = [];
  let cur = {};
  for (const line of sdb('vd_applist').split('\n')) {
    const m = /^-+(\w+)[^=]*=(.*?)-*$/.exec(line.trim());
    if (!m) continue;
    cur[m[1]] = m[2];
    if (m[1] === 'ambient_screen_support') { // last field of a block
      apps.push({ id: cur.app_tizen_id, name: cur.app_title, pkg: cur.app_package_name, installed: cur.install_date, uses: Number(cur.use_count), removable: cur.is_removable === '1', hidden: cur.is_hidden === '1', version: cur.app_version });
      cur = {};
    }
  }
  return apps;
}

const key = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '');
const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'list') {
  const apps = installed().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const groups = {};
  for (const a of apps) (groups[key(a.name)] ||= []).push(a);
  console.log(`${apps.length} apps ("dup" = same name more than once, "unused" = never started)`);
  for (const a of apps) {
    const flags = [groups[key(a.name)].length > 1 && 'dup', a.uses === 0 && 'unused', !a.removable && 'system'].filter(Boolean).join(',');
    console.log([a.name.padEnd(34), a.id.padEnd(38), a.installed, String(a.uses).padStart(5), flags].join('  '));
  }
} else if (cmd === 'remove' && args.some((a) => a !== '--yes')) {
  const yes = args.includes('--yes');
  const known = new Map(installed().map((a) => [a.id, a]));
  for (const id of args.filter((a) => a !== '--yes')) {
    const a = known.get(id);
    if (!a) { console.log(`${id}: not installed, skipped`); continue; }
    if (!a.removable) { console.log(`${id}: ${a.name} is a system app, skipped`); continue; }
    if (!yes) { console.log(`would uninstall ${a.name} (${id}), installed ${a.installed}, ${a.uses} uses`); continue; }
    console.log(`uninstalling ${a.name} (${id}): ${sdb('vd_appuninstall', a.pkg).trim()}`);
  }
  if (!yes) console.log('dry run, add --yes to uninstall');
} else {
  console.error('usage: apps.mjs list | remove <id>... [--yes]');
  process.exit(2);
}
