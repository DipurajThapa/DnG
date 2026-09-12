import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

const partsDir = new URL('./srcparts/', import.meta.url);
const parts = readdirSync(partsDir).filter((name) => name.endsWith('.htmlpart')).sort();
if (!parts.length) throw new Error('No Goliath HTML source parts found.');
const html = parts.map((name) => readFileSync(new URL(name, partsDir), 'utf8')).join('');
if (!html.includes('<title>Goliath Project Management Tracker</title>')) throw new Error('Goliath title missing from assembled artifact.');
if (/EDAPOS/i.test(html)) throw new Error('Unexpected EDAPOS branding remains in deployed artifact.');
mkdirSync(new URL('./public/', import.meta.url), { recursive: true });
writeFileSync(new URL('./public/index.html', import.meta.url), html, 'utf8');
const logoB64 = readFileSync(new URL('./assets/goliath-head.b64', import.meta.url), 'utf8').trim();
writeFileSync(new URL('./public/goliath-head.png', import.meta.url), Buffer.from(logoB64, 'base64'));
console.log(`Built Goliath review surface from ${parts.length} validated source parts.`);
