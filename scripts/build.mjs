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
const titleCase = name => name.replace(/^hermes-/, '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
const banner = async (name, fallback) => (await exists('assets/banners/' + name + '.webp')) ? 'assets/banners/' + name + '.webp' : (fallback || '');
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
  entries.push({
    listing: 'catalog',
    name: e.name,
    title: e.title || config.titles[e.name] || titleCase(e.name),
    category: categories[e.category] || 'General',
    summary: config.summaries?.[e.name] || summary.trim(),
    disclosure: disclosure.trim(),
    version: e.version || '',
    sha: e.sha || '',
    repo: e.repo,
    repoName,
    docs: `https://hermes-agent.nousresearch.com/docs/plugins/${e.name}`,
    env: e.requires_env || [],
    install: `hermes plugins install ${e.name}\nhermes plugins enable ${e.name}`,
    image: await banner(e.name, e.image),
    media: mediaFor(media[repoName], e.screenshots || []),
  });
}
if (!entries.length) throw new Error('No catalog entries found; refusing to publish an empty page.');

// Public plugins outside the catalog: our public, non-fork repositories with a
// plugin.yaml at the root that the catalog does not list. They install from
// GitHub at the latest commit, so their cards say they were not reviewed.
const listed = new Set(entries.map(e => e.repoName.toLowerCase()));
const repos = [];
for (let page = 1; ; page++) {
  const batch = await get(`https://api.github.com/users/${config.owner}/repos?per_page=100&page=${page}`);
  repos.push(...batch);
  if (batch.length < 100) break;
}
const tick = '`';
for (const repo of repos) {
  if (repo.private || repo.fork || repo.archived || config.exclude.includes(repo.name) || listed.has(repo.name.toLowerCase())) continue;
  const base = `https://raw.githubusercontent.com/${config.owner}/${repo.name}/${repo.default_branch}`;
  const extra = config.outside?.[repo.name] || {};
  let manifest;
  try { manifest = parseEntry(await get(`${base}/${extra.manifest || 'plugin.yaml'}`, false)); } catch { continue; }
  if (!manifest.name) continue;
  const readme = await get(`${base}/README.md`, false).catch(() => '');
  const pattern = new RegExp(String.raw`^\s*(hermes plugins install ${config.owner}/${repo.name}\b[^\r\n${tick}]*)$`, 'im');
  const found = readme.match(pattern)?.[1].trim();
  const install = extra.install ?? (found ? (/--enable\b/.test(found) ? found : `${found}\nhermes plugins enable ${manifest.name}`) : '');
  entries.push({
    listing: extra.pending ? 'pending' : 'outside',
    pending: extra.pending || '',
    name: manifest.name,
    title: extra.title || config.titles[manifest.name] || titleCase(manifest.name),
    category: extra.category || (/desktop/i.test(repo.description || '') ? 'Desktop' : 'Tools'),
    summary: extra.summary || repo.description || manifest.description || '',
    disclosure: '',
    version: String(manifest.version || ''),
    sha: '',
    repo: repo.html_url,
    repoName: repo.name,
    docs: '',
    setup: extra.setup || `${repo.html_url}#readme`,
    website: repo.homepage || '',
    env: (manifest.requires_env || []).filter(v => typeof v === 'string'),
    install,
    image: await banner(manifest.name, ''),
    media: mediaFor(media[repo.name], []),
  });
}

entries.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
const catalog = entries.filter(e => e.listing === 'catalog');
const outside = entries.filter(e => e.listing !== 'catalog');
for (const e of entries) console.log(`${e.listing}: ${e.category}: ${e.title} ${e.version || e.sha.slice(0, 8)}${e.image ? ' (banner)' : ''}`);

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const order = Object.values(categories);
const counts = order.map(c => [c, entries.filter(e => e.category === c).length]).filter(([, n]) => n);
const listingLabel = { pending: 'Catalog review pending', outside: 'Not in catalog' };

const card = (e, i) => `<article class="entry${e.listing === 'catalog' ? '' : ' entry-outside'}" id="${escape(e.name)}" data-category="${escape(e.category)}" data-listing="${e.listing}" data-search="${escape(`${e.title} ${e.name} ${e.summary} ${e.category} ${listingLabel[e.listing] || 'catalog'}`.toLowerCase())}">
  <div class="bar"><span class="bar-name">${escape(e.name)}</span><span class="bar-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
  ${e.image ? `<a class="art" href="${escape(e.repo)}" tabindex="-1" aria-hidden="true"><img src="${escape(e.image)}" alt="" width="960" height="480" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"></a>` : '<div class="art art-empty" aria-hidden="true"></div>'}
  <div class="entry-body">
    <p class="entry-meta"><span>${escape(e.category)}</span>${e.version ? `<span>v${escape(e.version)}</span>` : ''}${e.sha ? `<span class="sha" title="Pinned commit">@${escape(e.sha.slice(0, 8))}</span>` : ''}${listingLabel[e.listing] ? `<span class="listing">${listingLabel[e.listing]}</span>` : ''}</p>
    <h2><a href="${escape(e.repo)}">${escape(e.title)}</a></h2>
    <p class="summary">${escape(e.summary)}</p>
    ${e.env.length ? `<p class="env">Needs ${e.env.map(v => `<code>${escape(v)}</code>`).join(' ')}</p>` : ''}
    ${e.install ? `<div class="command"><code>${escape(e.install).replace(/\S+/g, word => `<span class="nb">${word.replaceAll('/', '/<wbr>')}</span>`)}</code><button type="button" class="copy" data-command="${escape(e.install)}" aria-label="Copy install commands for ${escape(e.title)}">Copy</button></div>` : `<p class="setup">Needs a few setup steps first. <a href="${escape(e.setup)}">Read the setup guide</a>.</p>`}
    ${e.listing === 'catalog' ? '' : `<p class="unreviewed">${e.install ? 'Installs from GitHub at the latest commit. ' : ''}Not reviewed by Hermes maintainers.</p>`}
    ${e.disclosure ? `<details><summary>What it touches</summary><p>${escape(e.disclosure)}</p></details>` : ''}
    <p class="entry-links">${e.docs ? `<a href="${escape(e.docs)}">Catalog page</a>` : ''}${e.pending ? `<a href="${escape(e.pending)}">Catalog PR</a>` : ''}${e.website ? `<a href="${escape(e.website)}">Website</a>` : ''}<a href="${escape(e.repo)}#readme">Source</a>${e.media.length ? `<a class="view" href="${escape(e.media[0].src)}" data-media="${escape(JSON.stringify(e.media))}" data-title="${escape(e.title)}">${e.media.some(m => m.demo) ? 'Demo' : e.media.length > 1 ? `Screenshots (${e.media.length})` : 'Screenshot'}</a>` : ''}</p>
  </div>
</article>`;

let page = await readFile(new URL('template.html', root), 'utf8');
page = page.replace('<!-- ENTRIES -->', catalog.map(card).join('\n'))
  .replace('<!-- OUTSIDE -->', outside.map((e, i) => card(e, i + catalog.length)).join('\n'))
  .replaceAll('{{COUNT}}', String(catalog.length))
  .replaceAll('{{OUTSIDE_COUNT}}', String(outside.length))
  .replaceAll('{{TOTAL}}', String(entries.length))
  .replace('{{FILTERS}}', counts.map(([c, n]) => `<button type="button" data-filter="${c}" aria-pressed="false">${c} <span>${n}</span></button>`).join(''))
  .replace('{{UPDATED}}', new Date().toISOString().slice(0, 10))
  .replace(/[ \t]+$/gm, '');
await writeFile(new URL('index.html', root), page);
await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/index.html', root), page);
await writeFile(new URL('dist/.nojekyll', root), '');
await cp(new URL('assets/', root), new URL('dist/assets/', root), { recursive: true });

// README galleries: two banners per row, regenerated between the markers.
function table(list) {
  const cell = e => {
    const install = e.install ? `<code>${escape(e.install.split('\n')[0])}</code>` : `<a href="${e.setup}">Setup guide</a>`;
    const tag = [e.category.toUpperCase(), e.version && `v${e.version}`, listingLabel[e.listing]?.toUpperCase()].filter(Boolean).map(escape).join(' · ');
    return `<td width="50%" valign="top"><a href="${e.repo}"><img src="${e.image}" alt="${escape(e.title)} banner" /></a><br /><strong><a href="${e.repo}">${escape(e.title)}</a></strong> &nbsp;<sub>${tag}</sub><br />${escape(e.summary)}<br />${install}</td>`;
  };
  const rows = [];
  for (let i = 0; i < list.length; i += 2) rows.push(`<tr>\n${cell(list[i])}\n${list[i + 1] ? cell(list[i + 1]) : '<td width="50%"></td>'}\n</tr>`);
  return `<table>\n${rows.join('\n')}\n</table>`;
}
const readmeUrl = new URL('README.md', root);
let readme = await readFile(readmeUrl, 'utf8');
readme = readme.replace(/<!-- PLUGINS:START -->[\s\S]*<!-- PLUGINS:END -->/, `<!-- PLUGINS:START -->\n${table(catalog)}\n<!-- PLUGINS:END -->`)
  .replace(/<!-- OUTSIDE:START -->[\s\S]*<!-- OUTSIDE:END -->/, `<!-- OUTSIDE:START -->\n${table(outside)}\n<!-- OUTSIDE:END -->`)
  .replace(/<!-- COUNT -->\d+<!-- \/COUNT -->/g, `<!-- COUNT -->${catalog.length}<!-- /COUNT -->`)
  .replace(/<!-- OUTSIDE_COUNT -->\d+<!-- \/OUTSIDE_COUNT -->/g, `<!-- OUTSIDE_COUNT -->${outside.length}<!-- /OUTSIDE_COUNT -->`);
await writeFile(readmeUrl, readme);
console.log(`Built ${catalog.length} catalog and ${outside.length} other entries.`);
