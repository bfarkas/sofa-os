// Makes the TV preview page from Sofa Home's own page, so the markup and the stylesheet cannot drift from the TV:
//   dist/preview.html     tv/app/index.html with its <style> moved to a file (Companion's CSP allows no inline style) and preview.js for main.js
//   dist/preview-tv.css   that <style>
//   dist/cards.css, dist/img/   copied from tv/app (the widget cards and the Kids Mode art)
// Run by `npm run build -w companion` after esbuild has made dist/preview.js. Node runs it as TypeScript.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const tv = new URL('../tv/app/', import.meta.url);
const dist = new URL('./dist/', import.meta.url);
mkdirSync(dist, { recursive: true });

let html = readFileSync(new URL('index.html', tv), 'utf8');
const style = /<style>([\s\S]*?)<\/style>/.exec(html);
if (!style) throw new Error('tv/app/index.html has no <style> block');
writeFileSync(new URL('preview-tv.css', dist), style[1]);
html = html.replace(style[0], '<link rel="stylesheet" href="preview-tv.css">');
const scripts = '<script src="env.js"></script>\n<script src="main.js"></script>';
if (!html.includes(scripts)) throw new Error('tv/app/index.html no longer ends with env.js and main.js; update companion/build-preview.ts');
html = html.replace(scripts, '<script src="preview.js"></script>').replace('<title>Sofa Home</title>', '<title>Sofa Home preview</title>');
writeFileSync(new URL('preview.html', dist), html);
cpSync(new URL('cards.css', tv), new URL('cards.css', dist));
cpSync(new URL('img/', tv), new URL('img/', dist), { recursive: true });
