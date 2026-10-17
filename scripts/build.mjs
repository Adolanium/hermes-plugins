// Builds the site (and the README plugin table) from the Hermes plugin catalog.
// The source of truth is NousResearch/hermes-agent plugin-catalog/: every entry
// whose repo belongs to config.owner is listed, at its reviewed pin.
import { readFile, writeFile, mkdir, cp, access } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('catalog.config.json', root)));
const media = JSON.parse(await readFile(new URL('media.json', root)));
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-plugins-catalog' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const UPSTREAM = config.catalog;
const RAW = `https://raw.githubusercontent.com/${UPSTREAM.repo}/${UPSTREAM.branch}/${UPSTREAM.path}`;

async function get(url, json = true) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (response.ok) return json ? response.json() : response.text();
    if (attempt === 3 || response.status === 404) throw new Error(`${response.status}: ${url}`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
  }
}

// Catalog entries are flat YAML. Read the top-level scalars and the one list we
// show (screenshots, capabilities.requires_env); folded blocks such as known_issues are skipped.
function parseEntry(text) {
  const entry = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const top = lines[i].match(/^([a-z_]+):\s*(.*)$/);
    if (top && !/^[>|]/.test(top[2])) {
      // A double-quoted scalar may fold over several lines; YAML joins them with a space.
      let value = top[2];
      while (value.startsWith('"') && !closed(value) && i + 1 < lines.length) value += ' ' + lines[++i].trim();
      entry[top[1]] = scalar(value);
    }
    if (/^screenshots:\s*$/.test(lines[i])) {
      entry.screenshots = [];
      while (lines[i + 1]?.match(/^\s*-\s+/)) entry.screenshots.push(scalar(lines[++i].replace(/^\s*-\s+/, '')));
    }
    const env = lines[i].match(/^\s+requires_env:\s*(.*)$/);
    if (env) {
      entry.requires_env = env[1].startsWith('[') ? env[1].slice(1, -1).split(',').map(s => scalar(s.trim())).filter(Boolean) : [];
      while (lines[i + 1]?.match(/^\s+-\s+/)) entry.requires_env.push(scalar(lines[++i].replace(/^\s+-\s+/, '')));
    }
  }
  return entry;
}
function closed(value) {
  try { JSON.parse(value.trim()); return true; } catch { return false; }
}
function scalar(value) {
  value = value.trim();
  if (value.startsWith('"')) return JSON.parse(value);
  value = value.replace(/\s+#.*$/, '');
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value === '[]' || value === '""') return '';
  return value;
}

const listing = await get(`https://api.github.com/repos/${UPSTREAM.repo}/contents/${UPSTREAM.path}?ref=${UPSTREAM.branch}`);
const files = listing.map(f => f.name).filter(n => n.endsWith('.yaml') && n !== 'removed.yaml');
const raw = [];
for (let i = 0; i < files.length; i += 32) {
  raw.push(...await Promise.all(files.slice(i, i + 32).map(async f => ({ file: f, text: await get(`${RAW}/${f}`, false) }))));
}
const ownerRepo = new RegExp(`^https://github\\.com/${config.owner}/`, 'i');
// Only our entries are parsed; the rest of the catalog may use YAML this reader skips.
const ownedEntry = new RegExp(String.raw`^repo:\s*["']?https://github\.com/${config.owner}/`, 'im');
const exists = path => access(new URL(path, root)).then(() => true, () => false);
const categories = { desktop: 'Desktop', tools: 'Tools', web: 'Web', models: 'Models', memory: 'Memory', platform: 'Platforms', voice: 'Voice', automation: 'Automation', general: 'General' };

// One list of things to show per card: the curated media.json item first, then
// the catalog's own screenshots. Video is told apart by type or extension.
function mediaFor(curated, screenshots) {
  const items = [];
  if (curated) items.push({ src: curated.source, video: curated.type === 'video', demo: curated.kind === 'demo' });
  for (const src of screenshots) if (!items.some(m => m.src === src)) items.push({ src, video: /\.(mp4|webm|mov)$/i.test(src), demo: false });
  return items;
}

const entries = [];
for (const { text } of raw) {
  if (!ownedEntry.test(text)) continue;
  const e = parseEntry(text);
  if (!ownerRepo.test(e.repo || '')) continue;
  const repoName = e.repo.replace(ownerRepo, '').replace(/\/$/, '');
  const [summary, disclosure = ''] = String(e.description || '').split(/\s*Disclosure\s*[—–-]\s*/);
  const banner = `assets/banners/${e.name}.webp`;
  entries.push({
    name: e.name,
    title: e.title || config.titles[e.name] || e.name.replace(/^hermes-/, '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    category: categories[e.category] || 'General',
    summary: config.summaries?.[e.name] || summary.trim(),
    disclosure: disclosure.trim(),
    version: e.version || '',
    sha: e.sha || '',
    repo: e.repo,
    repoName,
    docs: `https://hermes-agent.nousresearch.com/docs/plugins/${e.name}`,
    env: e.requires_env || [],
    image: (await exists(banner)) ? banner : (e.image || ''),
    media: mediaFor(media[repoName], e.screenshots || []),
  });
}
entries.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
for (const e of entries) console.log(`${e.category}: ${e.title} ${e.version || e.sha.slice(0, 8)}${e.image ? ' (banner)' : ''}`);
if (!entries.length) throw new Error('No catalog entries found; refusing to publish an empty page.');

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const order = Object.values(categories);
const counts = order.map(c => [c, entries.filter(e => e.category === c).length]).filter(([, n]) => n);
const command = e => `hermes plugins install ${e.name}\nhermes plugins enable ${e.name}`;

const cards = entries.map((e, i) => `<article class="entry" id="${escape(e.name)}" data-category="${escape(e.category)}" data-search="${escape(`${e.title} ${e.name} ${e.summary} ${e.category}`.toLowerCase())}">
  <div class="bar"><span class="bar-name">${escape(e.name)}</span><span class="bar-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
  ${e.image ? `<a class="art" href="${escape(e.repo)}" tabindex="-1" aria-hidden="true"><img src="${escape(e.image)}" alt="" width="960" height="480" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"></a>` : '<div class="art art-empty" aria-hidden="true"></div>'}
  <div class="entry-body">
    <p class="entry-meta"><span>${escape(e.category)}</span>${e.version ? `<span>v${escape(e.version)}</span>` : ''}<span class="sha" title="Pinned commit">@${escape(e.sha.slice(0, 8))}</span></p>
    <h2><a href="${escape(e.repo)}">${escape(e.title)}</a></h2>
    <p class="summary">${escape(e.summary)}</p>
    ${e.env.length ? `<p class="env">Needs ${e.env.map(v => `<code>${escape(v)}</code>`).join(' ')}</p>` : ''}
    <div class="command"><code>${escape(command(e)).replaceAll(escape(e.name), `<span class="nb">${escape(e.name)}</span>`)}</code><button type="button" class="copy" data-command="${escape(command(e))}" aria-label="Copy install commands for ${escape(e.title)}">Copy</button></div>
    ${e.disclosure ? `<details><summary>What it touches</summary><p>${escape(e.disclosure)}</p></details>` : ''}
    <p class="entry-links"><a href="${escape(e.docs)}">Catalog page</a><a href="${escape(e.repo)}#readme">Source</a>${e.media.length ? `<a class="view" href="${escape(e.media[0].src)}" data-media="${escape(JSON.stringify(e.media))}" data-title="${escape(e.title)}">${e.media.some(m => m.demo) ? 'Demo' : e.media.length > 1 ? `Screenshots (${e.media.length})` : 'Screenshot'}</a>` : ''}</p>
  </div>
</article>`).join('\n');

let page = await readFile(new URL('template.html', root), 'utf8');
page = page.replace('<!-- ENTRIES -->', cards)
  .replaceAll('{{COUNT}}', String(entries.length))
  .replace('{{FILTERS}}', counts.map(([c, n]) => `<button type="button" data-filter="${c}" aria-pressed="false">${c} <span>${n}</span></button>`).join(''))
  .replace('{{UPDATED}}', new Date().toISOString().slice(0, 10))
  .replace(/[ \t]+$/gm, '');
await writeFile(new URL('index.html', root), page);
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), page);
await writeFile(new URL('dist/.nojekyll', root), '');
await cp(new URL('assets/', root), new URL('dist/assets/', root), { recursive: true });

// README gallery: two banners per row, regenerated between the markers.
const rows = [];
for (let i = 0; i < entries.length; i += 2) {
  const cell = e => `<td width="50%" valign="top"><a href="${e.repo}"><img src="${e.image}" alt="${escape(e.title)} banner" /></a><br /><strong><a href="${e.repo}">${escape(e.title)}</a></strong> &nbsp;<sub>${escape(e.category.toUpperCase())}${e.version ? ` · v${escape(e.version)}` : ''}</sub><br />${escape(e.summary)}<br /><code>hermes plugins install ${escape(e.name)}</code></td>`;
  rows.push(`<tr>\n${cell(entries[i])}\n${entries[i + 1] ? cell(entries[i + 1]) : '<td width="50%"></td>'}\n</tr>`);
}
const readmeUrl = new URL('README.md', root);
const readme = await readFile(readmeUrl, 'utf8');
const gallery = `<!-- PLUGINS:START -->\n<table>\n${rows.join('\n')}\n</table>\n<!-- PLUGINS:END -->`;
await writeFile(readmeUrl, readme.replace(/<!-- PLUGINS:START -->[\s\S]*<!-- PLUGINS:END -->/, gallery).replace(/<!-- COUNT -->\d+<!-- \/COUNT -->/g, `<!-- COUNT -->${entries.length}<!-- /COUNT -->`));
console.log(`Built ${entries.length} entries.`);
