import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../catalog.config.json', import.meta.url)));
const root = new URL('../', import.meta.url);
const media = JSON.parse(await readFile(new URL('media.json', root)));
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hermes-plugins-catalog' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
async function api(path) {
  const response = await fetch(`https://api.github.com/${path}`, { headers });
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${path}`);
  return response.json();
}
const repos = [];
for (let page = 1; ; page++) {
  const batch = await api(`users/${config.owner}/repos?per_page=100&page=${page}`);
  repos.push(...batch);
  if (batch.length < 100) break;
}
const selected = repos.filter(r => !r.private && !r.archived && /^hermes-/i.test(r.name) && !config.exclude.includes(r.name) && !r.fork);
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names = { 'hermes-rss':'RSS', 'hermes-ssh':'SSH', 'hermes-plugin-openalex':'OpenAlex', 'hermes-plugin-shodan':'Shodan', 'hermes-clinepass':'ClinePass', 'hermes-resetwatch':'Resetwatch', 'hermes-ledgerline':'Ledgerline', 'hermes-tailscale':'Tailscale', 'hermes-plugin-backsearch':'BackSearch' };
const entries = [];
for (const repo of selected) {
  const readme = await api(`repos/${config.owner}/${repo.name}/readme`);
  const source = Buffer.from(readme.content, 'base64').toString('utf8');
  const category = /themes/.test(repo.name) ? 'Themes' : /pets/.test(repo.name) ? 'Pets' : /provider/i.test(repo.description) ? 'Providers' : /desktop/i.test(repo.description) ? 'Desktop' : 'Agent tools';
  const title = names[repo.name] || repo.name.replace(/^hermes-(plugin-)?/i, '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const commands = [...source.matchAll(/^\s*(hermes plugins install [^\r\n`]+)$/gm)].map(m => m[1].trim());
  const command = commands.find(c => c.includes(`${config.owner}/${repo.name}`)) || '';
  const candidates = [...source.matchAll(/<img\b[^>]*>/gi)].filter(m => !/width=["']?(?:96|32|48|64)["'\s]/.test(m[0])).map(m => m[0].match(/src=["']([^"']+)/)?.[1]).concat([...source.matchAll(/!\[[^\]]*\]\(([^\s)]+)/g)].map(m => m[1]));
  let screenshot = media[repo.name]?.image || '';
  const previewSource = media[repo.name]?.source || '';
  const previewKind = media[repo.name]?.kind || 'screenshot';
  for (const candidate of (screenshot ? [] : candidates.filter(Boolean))) {
    if (/shields\.io|badge|logo|icon|\.svg|avatar/i.test(candidate)) continue;
    const url = new URL(candidate, `https://raw.githubusercontent.com/${config.owner}/${repo.name}/${repo.default_branch}/`);
    if (!['github.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com'].includes(url.hostname) || url.protocol !== 'https:') continue;
    if (url.hostname === 'github.com' && url.pathname.includes('/blob/')) { url.hostname = 'raw.githubusercontent.com'; url.pathname = url.pathname.replace('/blob/', '/'); }
    const check = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (check.ok && /^image\//.test(check.headers.get('content-type') || '')) { screenshot = url.href; await check.body?.cancel(); break; }
    await check.body?.cancel();
  }
  entries.push({name:repo.name, title, category, description:repo.description || '', url:repo.html_url, command, screenshot, previewSource, previewKind, fork:repo.fork});
  console.log(`${category}: ${title}${screenshot ? ' (image)' : ''}${command ? ' (install command)' : ''}`);
}
// Stable order keeps the published page easy to compare across refreshes.
entries.sort((a,b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
const counts = Object.fromEntries(['Desktop','Agent tools','Providers','Themes','Pets'].map(c => [c, entries.filter(e => e.category === c).length]));
const cards = entries.map(e => `<article class="entry" data-category="${escape(e.category)}" data-search="${escape(`${e.title} ${e.description} ${e.category}`.toLowerCase())}">
  <div class="entry-body"><div class="entry-meta">${escape(e.category)}${e.fork ? ' <span>Fork</span>' : ''}</div><h2><a href="${e.url}">${escape(e.title)}</a></h2><p>${escape(e.description)}</p>
  <div class="entry-links"><a href="${e.url}#readme">Installation &amp; docs</a><a href="${e.url}">Source <span aria-hidden="true">↗</span></a></div>
  ${e.command ? `<details><summary>Install command</summary><div class="command"><code>${escape(e.command)}</code><button type="button" class="copy" data-command="${escape(e.command)}" aria-label="Copy install command for ${escape(e.title)}">Copy</button></div><p class="install-note">Read the installation docs for requirements, configuration and Desktop setup.</p></details>` : ''}</div>
  ${e.screenshot ? `<a class="preview" href="${escape(e.previewSource || e.screenshot)}" aria-label="${e.previewKind === 'demo' ? 'Watch' : 'View'} ${escape(e.title)} ${e.previewKind}"><img src="${escape(e.screenshot)}" alt="${escape(e.title)} preview from its repository" loading="lazy" decoding="async"><span class="preview-caption">${e.previewKind === 'demo' ? 'Watch demo' : 'View screenshot'} <span aria-hidden="true">&#8599;</span></span></a>` : ''}
</article>`).join('\n');
let template = await readFile(new URL('template.html', root), 'utf8');
template = template.replace('<!-- ENTRIES -->', cards).replaceAll('{{COUNT}}', String(entries.length)).replace('{{FILTERS}}', Object.entries(counts).filter(([,n]) => n).map(([c,n]) => `<button type="button" data-filter="${c}" aria-pressed="false">${c} <span>${n}</span></button>`).join('')).replace('{{UPDATED}}', new Date().toISOString().slice(0,10));
template = template.replace(/[ \t]+$/gm, '');
await writeFile(new URL('index.html', root), template);
await mkdir(new URL('dist/', root), { recursive:true });
await writeFile(new URL('dist/index.html', root), template);
await writeFile(new URL('dist/.nojekyll', root), '');
await cp(new URL('assets/', root), new URL('dist/assets/', root), { recursive:true });
console.log(`Built ${entries.length} entries.`);
