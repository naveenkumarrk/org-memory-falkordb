// org-memory UI. Plain JS, no build step. Every record string comes from session transcripts and is untrusted:
// it is only ever inserted with textContent (via el()), never as HTML.
const S = { corpus: localStorage.getItem('corpus') || 'prod', view: 'overview', sel: null, filters: {}, graph: null };
// deep links: #memory?sel=W-…  #graph?start=file:…  #preview?mode=prompt&input=…
function readHash() {
  const [v, q] = location.hash.slice(1).split('?');
  S.view = v || 'overview';
  const p = new URLSearchParams(q || '');
  if (p.get('sel')) S.sel = p.get('sel');
  if (p.get('start')) S.graphStart = p.get('start');
  if (p.get('input')) S.pv = { mode: p.get('mode') || 'file', input: p.get('input') };
  if (p.get('session')) S.selSession = p.get('session');
  if (p.get('file')) S.fileSel = p.get('file');
  if (p.get('mode')) S.gmode = p.get('mode');
  if (p.get('repo') !== null) S.grepo = p.get('repo');
}
readHash();
const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}
// replaceChildren() stringifies arrays, so always flatten (conditional sections are arrays or null)
const fill = (box, ...kids) => box.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
const api = (p, params = {}) => fetch(`/api/${p}?${new URLSearchParams({ corpus: S.corpus, ...params })}`).then((r) => r.json());
const post = (p, body) => fetch(`/api/${p}?corpus=${S.corpus}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-orgmem': '1' }, body: JSON.stringify(body) }).then((r) => r.json());
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); };
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');
const who = (email) => (email ? email.split('@')[0] : 'unknown');
const fileLabel = (id) => id.replace(/^file:/, '');
const VERIF = { landed: ['ok', 'landed on main'], committed: ['info', 'committed'], not_found: ['warn', 'commit not found'], none: ['', 'no commit'] };
const verifPill = (v) => { const [cls, txt] = VERIF[v?.commit] || ['', v?.commit || '?']; return el('span', { class: `pill ${cls}` }, txt); };
const statusPill = (s) => el('span', { class: `pill ${s === 'done' ? 'ok' : s === 'abandoned' ? 'bad' : s === 'partial' ? 'warn' : ''}` }, s);
const FACT = { current: ['ok', 'current'], changed_since: ['warn', 'code changed since'], not_on_main: ['', 'not on main'], unanchored: ['', 'no file'] };
const factPill = (s) => { const [c, t] = FACT[s] || ['', s]; return el('span', { class: `pill ${c}` }, t); };

function setView(v) { S.view = v; location.hash = v; render(); }
window.addEventListener('hashchange', () => { const before = S.view; readHash(); if (S.view !== before) render(); });
for (const a of document.querySelectorAll('#nav a')) a.addEventListener('click', () => setView(a.dataset.v));
for (const b of document.querySelectorAll('#mode button')) b.addEventListener('click', async () => {
  const m = b.dataset.m;
  const what = { shadow: 'SHADOW: hooks run in every Claude Code session and log what they would inject, but inject nothing.', on: 'ON: past-work knowledge will be injected into your Claude Code sessions (company repos).', off: 'OFF: hooks stay installed but do nothing.' }[m];
  if (!confirm(`${what}\n\nThis edits ~/.claude/settings.json (a backup is kept). Continue?`)) return;
  const r = await post('mode', { mode: m });
  toast(r.error ? r.error : `mode: ${r.mode}`);
  render();
});
for (const b of document.querySelectorAll('#corpus button')) b.addEventListener('click', () => { S.corpus = b.dataset.c; localStorage.setItem('corpus', S.corpus); S.sel = null; S.filters = {}; render(); });

async function chrome() {
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('on', a.dataset.v === S.view);
  for (const b of document.querySelectorAll('#corpus button')) b.classList.toggle('on', b.dataset.c === S.corpus);
  const [meta, st, health] = await Promise.all([api('meta'), api('stats'), api('health')]);
  const s = meta.settings;
  const mode = !health.install.installed ? 'none' : health.install.mode;
  for (const b of document.querySelectorAll('#mode button')) b.classList.toggle('on', b.dataset.m === mode);
  const h = $('#health');
  fill(h, el('span', { title: 'hooks in ~/.claude/settings.json' }, el('span', { class: health.install.installed ? 'dot-ok' : 'dot-bad' }), health.install.installed ? 'hooks installed' : 'hooks not installed'),
    ' · ', health.sync.running || health.backfill.running ? el('span', {}, el('span', { class: 'dot-warn' }), health.backfill.running ? 'backfill running' : 'live sync running') : 'live sync idle',
    ' · ', health.graph ? `graph ${health.graph.ageMin < 60 ? `${health.graph.ageMin} min` : `${Math.round(health.graph.ageMin / 60)} h`} old` : 'no graph');
  $('#n-work').textContent = st.nodes?.Work ?? '';
  $('#n-sessions').textContent = st.nodes?.Session ?? '';
  S.health = health;
  const stale = (st.factStatus?.changed_since || 0);
  $('#n-review').textContent = stale || '';
  return { meta, st };
}

async function render() {
  fill(main, el('div', { class: 'empty' }, 'Loading…'));
  const ctx = await chrome();
  const views = { overview, memory, sessions, files, graph, review, shadow, preview, activity, team, settings };
  if (ctx.st.empty && !['settings', 'team', 'activity'].includes(S.view)) {
    fill(main, el('h1', {}, 'No memory yet'), el('p', { class: 'sub' }, ctx.st.hint || ''), actionButtons());
    return;
  }
  await (views[S.view] || overview)(ctx);
}

function actionButtons() {
  const run = (action, label) => el('button', { onclick: async (e) => {
    if (action === 'backfill' && !confirm('Run extraction over all sessions in this corpus? It uses your Claude plan (Haiku) and only extracts chunks not already cached.')) return;
    e.target.disabled = true;
    const r = await post('action', { action });
    toast(r.error ? r.error : `${label} started — see Activity`);
  } }, label);
  return el('div', { class: 'row' }, run('build', 'Rebuild graph'), run('backfill', 'Extract new sessions'));
}

// ── Overview ─────────────────────────────────────────────────────────────
async function overview({ meta, st }) {
  const n = st.nodes || {}, e = st.edges || {}, v = st.verification || {}, h = st.hooks24h || {};
  const kpi = (val, label, sub) => el('div', { class: 'panel kpi' }, el('div', { class: 'v' }, val ?? 0), el('div', { class: 'l' }, label), sub ? el('div', { class: 's' }, sub) : null);
  const maxRepo = Math.max(1, ...(st.byRepo || []).map((r) => r.n));
  const days = (st.byMonth || []).slice(-45);
  const maxDay = Math.max(1, ...days.map((d) => d.n));
  const recent = await api('works', { limit: 6 });
  fill(main, 
    el('h1', {}, 'Overview'),
    el('p', { class: 'sub' }, S.corpus === 'prod' ? `Work memory from company sessions${meta.org ? ` on ${meta.org} repos` : ''}.` : 'Test memory from personal-folder sessions.'),
    el('div', { class: 'grid kpis' },
      kpi(n.Work, 'Work items', `${v.landed || 0} landed · ${v.committed || 0} committed`),
      kpi(n.Decision, 'Decisions'), kpi(n.Problem, 'Problems solved'), kpi(n.Fact, 'Facts', `${st.factStatus?.current || 0} current · ${st.factStatus?.changed_since || 0} stale`),
      kpi(n.File, 'Files linked', `${e.CO_CHANGED || 0} co-change links`), kpi(n.Commit, 'Commits verified'), kpi(n.Repo, 'Repos'), kpi(n.Session, 'Sessions')),
    el('div', { class: 'grid two', style: 'margin-top:14px' },
      el('div', { class: 'panel' }, el('h2', {}, 'Memory by repo'),
        ...(st.byRepo || []).slice(0, 10).map((r) => el('div', { class: 'bar' }, el('span', { class: 'mono', title: r.repo }, short(r.repo, 28)), el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(100 * r.n) / maxRepo}%` })), el('span', { class: 'muted' }, r.n)))),
      el('div', { class: 'panel' }, el('h2', {}, 'Hook activity · last 24 h'),
        el('div', { class: 'kv' }, el('div', {}, 'Triggers'), el('div', {}, h.events ?? 0), el('div', {}, 'Injected'), el('div', {}, `${h.injected ?? 0} (would inject ${h.wouldInject ?? 0})`),
          el('div', {}, 'Cards shown'), el('div', {}, h.cards ?? 0), el('div', {}, 'Latency'), el('div', {}, h.p50ms != null ? `p50 ${h.p50ms} ms · p95 ${h.p95ms} ms` : '—'),
          el('div', {}, 'Curation'), el('div', {}, `${st.overrides?.pinned || 0} pinned · ${st.overrides?.hidden || 0} hidden`)),
        el('h3', {}, 'Work recorded per day'), el('div', { class: 'spark', title: 'work items per day' }, ...days.map((d) => el('div', { title: `${d.d}: ${d.n}`, style: `height:${(100 * d.n) / maxDay}%` }))))),
    healthPanel(),
    el('div', { class: 'panel', style: 'margin-top:14px' }, el('div', { class: 'row' }, el('h2', {}, 'Latest work'), el('div', { class: 'right' }, actionButtons())),
      el('div', { class: 'list' }, ...recent.items.map((w) => workItem(w, () => { S.sel = w.id; setView('memory'); })))),
  );
}

function healthPanel() {
  const h = S.health;
  if (!h) return null;
  const ok = (cond, good, bad) => el('div', { class: 'check' }, el('span', { class: cond ? 'dot-ok' : 'dot-bad' }), cond ? good : bad);
  return el('div', { class: 'panel', style: 'margin-top:14px' }, el('h2', {}, 'Health'),
    ok(h.install.installed, `Hooks installed in ${h.install.claudeSettings}`, 'Hooks not installed — sessions are not observed'),
    el('div', { class: 'check' }, el('span', { class: h.install.mode === 'on' ? 'dot-ok' : h.install.mode === 'shadow' ? 'dot-warn' : 'dot-bad' }), `Mode: ${h.install.mode}${h.install.mode === 'shadow' ? ' — logging what would be injected, injecting nothing' : h.install.mode === 'on' ? ' — injecting cards' : ' — doing nothing'}`),
    ok(!!h.graph && h.graph.ageMin < 24 * 60, `Graph built ${h.graph ? fmtDate(h.graph.at) : ''} (${h.graph?.records ?? 0} work records)`, 'Graph older than a day — rebuild'),
    el('div', { class: 'check' }, el('span', { class: h.sync.running ? 'dot-warn' : 'dot-ok' }), h.sync.running ? 'Live sync running now' : `Live sync idle${h.sync.last.length ? ` · last: ${short(h.sync.last[h.sync.last.length - 1], 90)}` : ''}`),
    el('div', { class: 'check' }, el('span', { class: 'dot-ok' }), `${h.settings.excludedSessions.length} excluded session(s) · ${Object.values(h.settings.repos).filter((r) => r.include === false).length} excluded repo(s)`));
}

function workItem(w, onclick) {
  return el('div', { class: `item ${S.sel === w.id ? 'sel' : ''} ${w.hidden ? 'hidden' : ''}`, onclick },
    el('div', { class: 't' }, w.pinned ? '📌 ' : '', w.title),
    el('div', { class: 'm' }, el('span', {}, fmtDate(w.ended)), el('span', {}, who(w.person)), statusPill(w.status), verifPill(w.verification),
      ...(w.repos || []).slice(0, 2).map((r) => el('span', { class: 'mono' }, r.split('/').pop())),
      w.significance ? el('span', { class: `pill ${w.significance >= 4 ? 'info' : ''}`, title: 'significance (1–5) rated at extraction' }, `★${w.significance}`) : null,
      w.counts ? el('span', {}, `${w.counts.decisions}D · ${w.counts.problems}P · ${w.counts.facts}F · ${w.counts.files} files`) : null),
    el('div', { class: 'd' }, w.what_was_done));
}

// ── Work memory feed + detail ───────────────────────────────────────────
async function memory() {
  const f = S.filters;
  const [team, data] = await Promise.all([api('team'), api('works', { limit: 100, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })]);
  const sel = (key, label, opts) => el('select', { onchange: (e) => { f[key] = e.target.value; memory(); } }, el('option', { value: '' }, label), ...opts.map(([v, t]) => el('option', { value: v, selected: f[key] === v ? true : undefined }, t)));
  const chip = (key, val, label) => el('span', { class: `chip ${f[key] === val ? 'on' : ''}`, onclick: () => { f[key] = f[key] === val ? '' : val; memory(); } }, label);
  const search = el('input', { type: 'search', placeholder: 'Search work, decisions, problems, facts…', value: f.q || '' });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { f.q = search.value; memory(); } });
  const list = el('div', { class: 'list' }, ...(data.items.length ? data.items.map((w) => workItem(w, () => { S.sel = w.id; memory(); })) : [el('div', { class: 'empty' }, 'No work matches these filters.')]));
  const detail = el('div', { class: 'panel detail' }, el('div', { class: 'empty' }, 'Select a work item to see its decisions, problems, facts and evidence.'));
  fill(main, 
    el('h1', {}, 'Work memory'), el('p', { class: 'sub' }, 'Everything the team did, newest first. Each item links to the files, commits and decisions behind it.'),
    el('div', { class: 'filters' }, search,
      sel('repo', 'All repos', (team.repos || []).map((r) => [r.slug, r.slug])),
      sel('person', 'Everyone', (team.people || []).map((p) => [p.email, who(p.email)])),
      sel('sort', 'Newest first', [['sig', 'Most significant first']]),
      el('label', { class: 'row small muted' }, el('input', { type: 'checkbox', checked: f.hidden === '1', onchange: (e) => { f.hidden = e.target.checked ? '1' : ''; memory(); } }), 'show hidden')),
    el('div', { class: 'chips' }, chip('status', 'done', 'Done'), chip('status', 'partial', 'Partial'), chip('status', 'investigation', 'Investigations'), chip('status', 'abandoned', 'Abandoned'),
      el('span', { class: 'muted small' }, '·'), chip('verif', 'landed', 'Landed on main'), chip('verif', 'committed', 'Committed'), chip('verif', 'none', 'No commit'), el('span', { class: 'muted small' }, '·'), chip('minsig', '4', '★4+ significant')),
    el('div', { class: 'split' }, list, detail));
  if (S.sel) showWork(S.sel, detail);
}

async function showWork(id, box) {
  const w = await api('work', { id });
  if (!w || !w.title) { fill(box, el('div', { class: 'empty' }, 'Not found.')); return; }
  const act = await api('activity', { limit: 2000 });
  const injected = act.hooks.filter((h) => h.cards.some((c) => c.work === id));
  const ov = (action) => async () => { await post('override', { id, action }); toast(`${action} done`); S.view === 'memory' ? memory() : review(); };
  const note = el('textarea', { rows: 2, placeholder: 'Team note (local)…', value: w.note || '' });
  const fileChips = (ids) => el('div', { class: 'files' }, ...ids.map((fid) => el('span', { class: 'file', title: 'open file history', onclick: () => { S.fileSel = fid; setView('files'); } }, fileLabel(fid))));
  const recBlock = (kind, title, sub, quote, files, extra) => el('div', { class: `rec ${kind}` }, el('div', {}, el('b', {}, title), extra ? ' ' : '', extra || ''), sub ? el('div', { class: 'muted small' }, sub) : null, quote ? el('blockquote', {}, quote) : null, files?.length ? fileChips(files) : null);
  fill(box, 
    el('div', { class: 't' }, w.title),
    el('div', { class: 'row' }, statusPill(w.status), verifPill(w.verification), w.verification?.tests !== 'none' ? el('span', { class: `pill ${w.verification?.tests === 'passed' ? 'ok' : 'bad'}` }, `tests ${w.verification?.tests}`) : null,
      w.pinned ? el('span', { class: 'pill info' }, 'pinned') : null, w.hidden ? el('span', { class: 'pill bad' }, 'hidden') : null),
    el('div', { class: 'kv' }, el('div', {}, 'When'), el('div', {}, `${fmtDate(w.started)} → ${fmtDate(w.ended)}`), el('div', {}, 'Who'), el('div', {}, w.person || 'unknown'),
      el('div', {}, 'Repos'), el('div', { class: 'mono' }, (w.repos || []).join(', ') || '—'), el('div', {}, 'Session'), el('div', { class: 'mono' }, `${w.session} · P${w.prompts?.[0]}–P${w.prompts?.[1]}`),
      el('div', {}, 'Injected'), el('div', {}, injected.length ? `${injected.length}× ${injected[0].shadow ? '(shadow, logged only)' : 'into agent sessions'} · last ${fmtDate(injected[0].ts)}` : 'never yet'),
      el('div', {}, 'Significance'), el('div', {}, w.significance ? `★${w.significance} of 5 (rated at extraction)` : '—'),
      el('div', {}, 'Feedback'), el('div', {}, voteButtons(w.id, 'ui', 'ui', w.feedback?.up ? 'up' : w.feedback?.down ? 'down' : null, () => {}), ` ${w.feedback?.up || 0} 👍 · ${w.feedback?.down || 0} 👎 overall`)),
    el('h3', {}, 'Goal'), el('div', {}, w.goal), el('h3', {}, 'What was done'), el('div', {}, w.what_was_done),
    w.commits.length ? [el('h3', {}, 'Commits'), ...w.commits.map((c) => el('div', { class: 'small' }, el('span', { class: 'mono' }, String(c.sha).slice(0, 10)), ' ', c.landed ? el('span', { class: 'pill ok' }, 'on main') : el('span', { class: 'pill info' }, 'branch'), ' ', c.subject))] : null,
    w.files.length ? [el('h3', {}, `Files (${w.files.length})`), fileChips(w.files.map((f) => f.id))] : null,
    w.things?.length ? [el('h3', {}, 'Topics'), el('div', { class: 'files' }, ...w.things.map((t) => el('span', { class: 'file' }, t)))] : null,
    w.decisions.length ? [el('h3', {}, 'Decisions'), ...w.decisions.map((d) => recBlock('decision', d.choice, `Why: ${d.why}`, d.evidence_quote, d.files, d.file_status === 'changed_since' ? factPill(d.file_status) : null))] : null,
    w.problems.length ? [el('h3', {}, 'Problems'), ...w.problems.map((p) => recBlock('problem', p.symptom, `Cause: ${p.cause} · Resolution: ${p.resolution}`, p.evidence_quote, p.files))] : null,
    w.facts.length ? [el('h3', {}, 'Facts'), ...w.facts.map((x) => recBlock('fact', x.statement, null, x.evidence_quote, x.files, factPill(x.status)))] : null,
    w.related?.length ? [el('h3', {}, 'Related work (changed the same files)'), ...w.related.map((r) => el('div', { class: 'small', style: 'margin:3px 0' }, el('a', { onclick: () => { S.sel = r.id; memory(); } }, r.title), el('span', { class: 'muted' }, ` · ${fmtDate(r.ended)} · ${r.shared} shared file${r.shared > 1 ? 's' : ''}`)))] : null,
    el('h3', {}, 'Curation'), note,
    el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { onclick: async () => { await post('override', { id, action: w.pinned ? 'unpin' : 'pin', note: note.value }); toast('saved'); memory(); } }, w.pinned ? 'Unpin' : 'Pin (boost in results)'),
      el('button', { class: 'danger', onclick: ov(w.hidden ? 'unhide' : 'hide') }, w.hidden ? 'Unhide' : 'Hide (never inject)'),
      el('button', { onclick: async () => { await post('override', { id, action: w.pinned ? 'pin' : 'unpin', note: note.value }); toast('note saved'); } }, 'Save note'),
      el('button', { onclick: () => { S.graphStart = id; setView('graph'); } }, 'Open in graph')),
  );
}

// ── Graph (Obsidian-style: live force layout, degree-sized dots, zoom-faded labels, hover highlight) ──────────
const TYPE_COLOR = { Work: '#8b7cf6', File: '#9aa4b1', Decision: '#e0a458', Problem: '#e06c75', Fact: '#4cc38a', Commit: '#d9b44a', Person: '#61afef', Thing: '#3fbcc5', Session: '#7f8c8d', Repo: '#c678dd', Dir: '#6b7684' };
const GRAPH_DEFAULTS = { textFade: 1.8, nodeSize: 1, linkWidth: 1, arrows: false, center: 0.05, repel: 260, linkForce: 0.5, linkDistance: 70, colorBy: 'type', hidden: [] };
function graphPrefs() { try { return { ...GRAPH_DEFAULTS, ...JSON.parse(localStorage.getItem('graphPrefs') || '{}') }; } catch { return { ...GRAPH_DEFAULTS }; } }
function saveGraphPrefs(p) { try { localStorage.setItem('graphPrefs', JSON.stringify(p)); } catch { /* storage may be unavailable */ } }
const hashColor = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return `hsl(${Math.abs(h) % 360} 55% 62%)`; };

async function graph() {
  const prefs = graphPrefs();
  S.gmode = S.gmode || 'local';
  S.ghist = S.ghist || [];
  const team = await api('team');
  if (!S.graphStart) S.graphStart = (await api('top-files'))[0]?.id;
  const canvasBox = el('div', { class: 'gcanvas' });
  const detail = el('div', { class: 'gdetail', style: 'display:none' });
  const info = el('span', { class: 'small muted' });
  const search = el('input', { type: 'search', placeholder: 'Find a file, work item, topic…', style: 'width:300px' });
  const sugg = el('div', { class: 'suggest', style: 'display:none' });
  const depth = el('input', { type: 'range', min: 1, max: 3, step: 1, value: S.gdepth || 2, style: 'width:90px' });
  const depthLbl = el('span', { class: 'small muted' }, `depth ${depth.value}`);
  const repoSel = el('select', {}, el('option', { value: '' }, 'All repos'), ...(team.repos || []).map((r) => el('option', { value: r.slug, selected: (S.grepo ?? team.repos?.[0]?.slug) === r.slug ? true : undefined }, r.slug)));
  const knowledge = el('label', { class: 'row small muted' }, el('input', { type: 'checkbox', checked: !!S.gknow, onchange: (e) => { S.gknow = e.target.checked; load(); } }), 'decisions, problems, facts');
  const modeSeg = el('div', { class: 'seg' }, ...['local', 'global'].map((m) => el('button', { class: S.gmode === m ? 'on' : '', onclick: () => { S.gmode = m; graph(); } }, m === 'local' ? 'Local graph' : 'Global graph')));
  const back = el('button', { title: 'previous centre', disabled: !S.ghist.length ? true : undefined, onclick: () => { S.graphStart = S.ghist.pop(); load(); } }, '←');
  const fit = el('button', { onclick: () => fg?.zoomToFit(500, 50) }, 'Fit');

  // settings panel (Filters / Groups / Display / Forces), like Obsidian's graph settings
  const slider = (label, key, min, max, step, onchg) => {
    const v = el('span', { class: 'mono small' }, prefs[key]);
    return el('div', { class: 'gs-row' }, el('span', {}, label), el('input', { type: 'range', min, max, step, value: prefs[key], oninput: (e) => { prefs[key] = Number(e.target.value); v.textContent = prefs[key]; saveGraphPrefs(prefs); onchg(); } }), v);
  };
  const highlight = el('input', { type: 'search', placeholder: 'Highlight matches…', style: 'width:100%' });
  highlight.addEventListener('input', () => { S.ghl = highlight.value.toLowerCase(); fg?.nodeColor(fg.nodeColor()); });
  const typeToggles = el('div', { class: 'gs-types' }, ...Object.keys(TYPE_COLOR).map((t) => el('label', {}, el('input', { type: 'checkbox', checked: !prefs.hidden.includes(t), onchange: (e) => { prefs.hidden = e.target.checked ? prefs.hidden.filter((x) => x !== t) : [...prefs.hidden, t]; saveGraphPrefs(prefs); applyData(); } }), el('i', { style: `background:${TYPE_COLOR[t]}` }), t)));
  const colorBy = el('select', { onchange: (e) => { prefs.colorBy = e.target.value; saveGraphPrefs(prefs); } }, ...[['type', 'Type'], ['repo', 'Repo'], ['status', 'Status'], ['significance', 'Significance']].map(([v, t]) => el('option', { value: v, selected: prefs.colorBy === v ? true : undefined }, t)));
  const settingsPanel = el('div', { class: 'gsettings' },
    el('details', { open: true }, el('summary', {}, 'Filters'), highlight, typeToggles),
    el('details', {}, el('summary', {}, 'Groups'), el('div', { class: 'gs-row' }, el('span', {}, 'Colour by'), colorBy)),
    el('details', {}, el('summary', {}, 'Display'),
      el('label', { class: 'gs-row' }, el('span', {}, 'Arrows'), el('input', { type: 'checkbox', checked: prefs.arrows, onchange: (e) => { prefs.arrows = e.target.checked; saveGraphPrefs(prefs); fg?.linkDirectionalArrowLength(prefs.arrows ? 3.5 : 0); } })),
      slider('Text fade', 'textFade', 0.3, 4, 0.1, () => {}), slider('Node size', 'nodeSize', 0.4, 2.5, 0.1, () => {}), slider('Link width', 'linkWidth', 0.3, 3, 0.1, () => {})),
    el('details', {}, el('summary', {}, 'Forces'),
      slider('Centre', 'center', 0, 0.5, 0.01, () => applyForces(true)), slider('Repel', 'repel', 10, 600, 10, () => applyForces(true)),
      slider('Link force', 'linkForce', 0.05, 1, 0.05, () => applyForces(true)), slider('Link distance', 'linkDistance', 10, 200, 5, () => applyForces(true)),
      el('button', { style: 'margin-top:6px', onclick: () => fg?.d3ReheatSimulation() }, 'Animate')));

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (search.value.length < 2) { sugg.style.display = 'none'; return; }
    const res = await api('find', { q: search.value });
    fill(sugg, res.map((r) => el('div', { onclick: () => { sugg.style.display = 'none'; S.gmode = 'local'; recenter(r.id); } }, el('span', { class: 'pill' }, r.type), ' ', short(r.label, 70))));
    sugg.style.display = res.length ? 'block' : 'none';
  }, 200); });
  depth.addEventListener('input', () => { depthLbl.textContent = `depth ${depth.value}`; });
  depth.addEventListener('change', () => { S.gdepth = Number(depth.value); load(); });
  repoSel.addEventListener('change', () => { S.grepo = repoSel.value; load(); });

  fill(main, el('div', { class: 'row', style: 'margin-bottom:10px;position:relative' }, el('h1', { style: 'margin:0 12px 0 0' }, 'Graph'), modeSeg,
      S.gmode === 'local' ? [back, search, el('span', { class: 'row' }, depthLbl, depth)] : [repoSel, knowledge], fit, info), sugg,
    el('div', { class: 'gwrap' }, canvasBox, settingsPanel, detail,
      el('div', { class: 'ghint' }, 'Hover: highlight links · Scroll: zoom (labels fade in) · Drag: move · Click: details · Double-click: re-centre')));

  if (typeof ForceGraph === 'undefined') { fill(canvasBox, el('div', { class: 'empty' }, 'Graph library failed to load (offline?). Everything else still works.')); return; }
  const css = getComputedStyle(document.documentElement);
  const bg = css.getPropertyValue('--panel').trim();
  const textColor = css.getPropertyValue('--text').trim();
  const accent = css.getPropertyValue('--accent').trim();
  let raw = { nodes: [], links: [] };
  let hoverNode = null;
  let selected = null;
  const hl = { nodes: new Set(), links: new Set() };
  let lastClick = { id: null, t: 0 };

  const colorOf = (n) => {
    if (prefs.colorBy === 'repo') return hashColor((n.props?.repos?.[0]) || (String(n.id).split(':')[1] || ''));
    if (prefs.colorBy === 'status' && n.type === 'Work') return ({ done: '#4cc38a', partial: '#e0a458', investigation: '#61afef', abandoned: '#e06c75' })[n.props?.status ?? n.status] || '#9aa4b1';
    if (prefs.colorBy === 'significance' && n.type === 'Work') { const s = n.props?.significance ?? n.significance ?? 3; return `hsl(${250 - s * 30} 70% ${45 + s * 4}%)`; }
    return TYPE_COLOR[n.type] || '#9aa4b1';
  };
  // size by links visible in this graph (not global degree, so a person or topic linked to everything stays small)
  const radius = (n) => prefs.nodeSize * (n.type === 'Work' ? 3.4 : 2.6) * (1 + Math.min(Math.sqrt(n.vdeg || 1), 4) * 0.3) * (n.level === 0 ? 1.7 : 1);

  const fg = ForceGraph()(canvasBox)
    .backgroundColor(bg)
    .nodeId('id')
    .linkSource('source').linkTarget('target')
    .nodeRelSize(1)
    .nodeVal((n) => radius(n) ** 2)
    .linkColor((l) => (hl.links.has(l) ? accent : S.gmode === 'global' ? 'rgba(140,150,165,0.14)' : 'rgba(140,150,165,0.3)'))
    .linkWidth((l) => (hl.links.has(l) ? 2 : 1) * prefs.linkWidth)
    .linkDirectionalArrowLength(prefs.arrows ? 3.5 : 0).linkDirectionalArrowRelPos(1)
    .nodeCanvasObject((n, ctx, scale) => {
      const dim = hl.nodes.size && !hl.nodes.has(n);
      const match = S.ghl && String(n.full || n.label).toLowerCase().includes(S.ghl);
      const r = radius(n);
      ctx.globalAlpha = dim ? 0.15 : 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI); ctx.fillStyle = colorOf(n); ctx.fill();
      if (n === selected || n.level === 0 || match) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = match ? '#ffd166' : accent; ctx.stroke(); }
      // labels fade in with zoom (Obsidian's "text fade threshold"); always on for hovered/selected/centre/matches
      // a label appears once the node is big enough on screen: large/central nodes first, leaves as you zoom in
      const focus = n === hoverNode || n === selected || n.level === 0;
      const always = focus || match || (hl.nodes.size && hl.nodes.has(n));
      const a = always ? 1 : Math.max(0, Math.min(1, (scale * r - prefs.textFade * 10) / 6));
      if (a > 0.02 && !dim) {
        const fs = 11 / scale;
        const text = focus ? (n.full || n.label) : short(n.label, 30);
        ctx.font = `${n.type === 'Work' || n.level === 0 ? '600 ' : ''}${fs}px -apple-system, Segoe UI, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.globalAlpha = a;
        if (focus) { const w = ctx.measureText(text).width; ctx.fillStyle = bg; ctx.fillRect(n.x - w / 2 - 3 / scale, n.y + r + 1 / scale, w + 6 / scale, fs + 3 / scale); }
        ctx.fillStyle = textColor;
        ctx.fillText(text, n.x, n.y + r + 2 / scale);
      }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, radius(n) + 2, 0, 2 * Math.PI); ctx.fill(); })
    .onNodeHover((n) => {
      hoverNode = n || null;
      hl.nodes.clear(); hl.links.clear();
      if (n) { hl.nodes.add(n); for (const l of raw.links) if (l.source === n || l.target === n) { hl.links.add(l); hl.nodes.add(l.source); hl.nodes.add(l.target); } }
      canvasBox.style.cursor = n ? 'pointer' : 'default';
    })
    .onNodeClick((n) => {
      const now = Date.now();
      if (lastClick.id === n.id && now - lastClick.t < 350 && S.gmode === 'local') { recenter(n.id); return; }
      lastClick = { id: n.id, t: now };
      selected = n; showNodeDetail(n);
    })
    .onBackgroundClick(() => { selected = null; detail.style.display = 'none'; })
    .cooldownTime(4000)
    .onEngineStop(() => { if (!S.gfitted) { fg.zoomToFit(500, 50); S.gfitted = true; } });
  S.graph = fg;
  const resize = () => fg.width(canvasBox.clientWidth).height(canvasBox.clientHeight);
  new ResizeObserver(resize).observe(canvasBox);

  function applyForces(reheat) {
    fg.d3Force('charge').strength(-prefs.repel * (S.gmode === 'global' ? 0.35 : 1));
    // links out of the centre are longer so the first ring has room for its labels
    fg.d3Force('link').distance((l) => prefs.linkDistance * (l.rel === 'CO_CHANGED' ? 1.6 : 1) * ((l.source.level === 0 || l.target.level === 0) ? 1.9 : 1)).strength(prefs.linkForce);
    fg.d3Force('center').strength(prefs.center);
    if (reheat) fg.d3ReheatSimulation();
  }
  function applyData() {
    const hidden = new Set(prefs.hidden);
    const nodes = raw.nodes.filter((n) => !hidden.has(n.type) || n.level === 0);
    const ids = new Set(nodes.map((n) => n.id));
    fg.graphData({ nodes, links: raw.links.filter((l) => ids.has(l.source.id ?? l.source) && ids.has(l.target.id ?? l.target)) });
  }
  function recenter(id) {
    if (S.graphStart && S.graphStart !== id) S.ghist.push(S.graphStart);
    S.graphStart = id; back.disabled = false; load();
  }
  async function load() {
    S.gfitted = false; selected = null; detail.style.display = 'none';
    const g = S.gmode === 'local'
      ? await api('graph', { id: S.graphStart, depth: S.gdepth || 2 })
      : await api('graph-global', { repo: repoSel.value, knowledge: S.gknow ? '1' : '0' });
    const vdeg = new Map();
    for (const e of g.edges) { vdeg.set(e.src, (vdeg.get(e.src) || 0) + 1); vdeg.set(e.dst, (vdeg.get(e.dst) || 0) + 1); }
    raw = { nodes: g.nodes.map((n) => ({ ...n, vdeg: vdeg.get(n.id) || 0, ...(n.level === 0 ? { fx: 0, fy: 0 } : {}) })), links: g.edges.map((e) => ({ source: e.src, target: e.dst, rel: e.rel })) };
    info.textContent = `${g.nodes.length} nodes · ${g.edges.length} links${S.gmode === 'local' ? ` · centre: ${short(g.nodes.find((n) => n.level === 0)?.full || '', 60)}` : ''}`;
    applyForces(false);
    applyData();
    // fit once the layout has spread out (and again when the simulation settles)
    clearTimeout(S.gfitTimer);
    S.gfitTimer = setTimeout(() => { fg.zoomToFit(600, 60); S.gfitted = true; }, 1600);
  }

  function showNodeDetail(n) {
    const p = n.props || n;
    const rows = [];
    const kv = (k, v) => { if (v !== undefined && v !== null && v !== '') rows.push(el('div', { class: 'muted' }, k), el('div', {}, String(v))); };
    if (n.type === 'Work') { kv('When', fmtDate(p.ended)); kv('Who', p.person); kv('Status', p.status); kv('Commit', p.verification?.commit); kv('Significance', p.significance ? `★${p.significance}` : ''); }
    if (n.type === 'Decision') { kv('Why', p.why); kv('Code', p.file_status); }
    if (n.type === 'Problem') { kv('Cause', p.cause); kv('Resolution', p.resolution); }
    if (n.type === 'Fact') kv('Status', p.status);
    if (n.type === 'Commit') { kv('Subject', p.subject); kv('On main', p.landed ? 'yes' : 'no'); }
    if (n.type === 'File') kv('Repo', p.slug || String(n.id).split(':')[1]);
    kv('Links', n.degree);
    const links = raw.links.filter((l) => l.source === n || l.target === n).slice(0, 8);
    fill(detail, el('div', { class: 'row' }, el('span', { class: 'pill', style: `background:${colorOf(n)};color:#111` }, n.type), el('button', { class: 'right', onclick: () => { selected = null; detail.style.display = 'none'; } }, '×')),
      el('div', { style: 'font-weight:700;margin:8px 0' }, n.full || n.label),
      p.what_was_done ? el('div', { class: 'small', style: 'margin-bottom:8px' }, short(p.what_was_done, 320)) : null,
      p.evidence_quote ? el('blockquote', {}, p.evidence_quote) : null,
      el('div', { class: 'kv' }, ...rows),
      links.length ? [el('h3', {}, 'Connected'), ...links.map((l) => { const o = l.source === n ? l.target : l.source; return el('div', { class: 'small', style: 'margin:2px 0' }, el('span', { class: 'muted' }, `${l.rel} · `), el('a', { onclick: () => { selected = o; showNodeDetail(o); fg.centerAt(o.x, o.y, 500); } }, short(o.full || o.label, 60))); })] : null,
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { onclick: () => { S.gmode = 'local'; recenter(n.id); if (S.view === 'graph') graph(); } }, 'Local graph from here'),
        n.type === 'Work' ? el('button', { onclick: () => { S.sel = n.id; setView('memory'); } }, 'Open work') : null,
        n.type === 'File' ? el('button', { onclick: () => { S.fileSel = n.id; setView('files'); } }, 'File history') : null));
    detail.style.display = 'block';
  }
  await load();
}

// ── Review (stale knowledge) ─────────────────────────────────────────────
async function review() {
  const data = await api('works', { limit: 200 });
  const details = await Promise.all(data.items.slice(0, 200).map((w) => api('work', { id: w.id })));
  const stale = details.flatMap((w) => [...w.facts.filter((f) => f.status === 'changed_since').map((f) => ({ w, kind: 'Fact', text: f.statement, files: f.files })),
    ...w.decisions.filter((d) => d.file_status === 'changed_since').map((d) => ({ w, kind: 'Decision', text: d.choice, files: d.files }))]);
  fill(main, el('h1', {}, 'Review'), el('p', { class: 'sub' }, 'Knowledge whose code changed after it was recorded. Stale facts are never injected; decisions are still shown. Hide anything that is no longer true.'),
    stale.length ? el('div', { class: 'panel' }, el('table', {}, el('tr', {}, el('th', {}, 'Kind'), el('th', {}, 'Statement'), el('th', {}, 'Files'), el('th', {}, 'Recorded'), el('th', {}, '')),
      ...stale.map((x) => el('tr', {}, el('td', {}, x.kind), el('td', {}, x.text, el('div', { class: 'small muted' }, `from: ${x.w.title}`)), el('td', { class: 'mono small' }, x.files.map(fileLabel).join('\n')), el('td', { class: 'small' }, fmtDate(x.w.ended)),
        el('td', {}, el('button', { onclick: () => { S.sel = x.w.id; setView('memory'); } }, 'Open')))))) : el('div', { class: 'panel empty' }, 'Nothing stale among the latest 200 work items.'));
}

// ── What Claude sees (preview) ───────────────────────────────────────────
async function preview({ meta }) {
  const s = structuredClone(meta.settings);
  S.pv = S.pv || { mode: 'file', input: '' };
  const out = el('pre', { class: 'inject' }, 'Type a file path (e.g. src/server.ts), a prompt, or an error, then Run.');
  const stats = el('div', { class: 'small muted' });
  const cardsBox = el('div');
  const input = el('input', { type: 'search', style: 'flex:1', value: S.pv.input, placeholder: 'file path, repo/slug:path, or a prompt' });
  const modeSeg = el('div', { class: 'seg' }, ...['file', 'prompt', 'error'].map((m) => el('button', { class: S.pv.mode === m ? 'on' : '', onclick: () => { S.pv.mode = m; preview({ meta }); } }, m === 'file' ? 'Agent opens a file' : m === 'prompt' ? 'User sends a prompt' : 'A command fails')));
  const run = async () => {
    S.pv.input = input.value;
    if (!input.value.trim()) return;
    const r = await api('preview', { mode: S.pv.mode, input: input.value, settings: JSON.stringify({ weights: s.weights, cardsPerTrigger: s.cardsPerTrigger, itemsPerTrigger: s.itemsPerTrigger, minScore: s.minScore, show: s.show, delivery: s.delivery }) });
    out.textContent = r.text || '(nothing injected — no related verified work passes the threshold)';
    stats.textContent = `anchors: ${r.anchors.map(fileLabel).join(', ') || 'none'} · ${r.cards.length} card(s) · ${r.text.length} chars ≈ ${Math.ceil(r.text.length / 4)} tokens · lookup ${r.ms.toFixed(1)} ms`;
    fill(cardsBox, r.cards.length ? el('table', {}, el('tr', {}, el('th', {}, 'Score'), el('th', {}, 'Why it was picked'), el('th', {}, 'Work')), ...r.cards.map((c) => el('tr', {}, el('td', {}, c.score), el('td', {}, c.via), el('td', {}, el('a', { onclick: () => { S.sel = c.work; setView('memory'); } }, c.title))))) : '');
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  const slider = (label, obj, key, min, max, step) => {
    const val = el('span', { class: 'mono' }, obj[key]);
    return [el('span', {}, label), el('input', { type: 'range', min, max, step, value: obj[key], oninput: (e) => { obj[key] = Number(e.target.value); val.textContent = obj[key]; run(); } }), val];
  };
  const check = (label, key) => el('label', { class: 'row small' }, el('input', { type: 'checkbox', checked: s.show[key], onchange: (e) => { s.show[key] = e.target.checked; run(); } }), label);
  fill(main, el('h1', {}, 'What Claude sees'), el('p', { class: 'sub' }, 'The exact text the hook would inject. Move the sliders to see how ranking changes, then save them as the defaults.'),
    el('div', { class: 'grid two' },
      el('div', {}, el('div', { class: 'row' }, modeSeg), el('div', { class: 'row', style: 'margin:10px 0' }, input, el('button', { class: 'primary', onclick: run }, 'Run')), stats, el('div', { style: 'margin-top:8px' }, out), el('div', { style: 'margin-top:12px' }, cardsBox)),
      el('div', { class: 'panel' }, el('h2', {}, 'Ranking (unsaved)'),
        el('div', { class: 'sliders' }, ...slider('Changed this file', s.weights, 'touched', 0, 1, 0.05), ...slider('Knowledge about file', s.weights, 'about', 0, 1, 0.05), ...slider('Used this file', s.weights, 'referenced', 0, 1, 0.05),
          ...slider('Co-changed file', s.weights, 'coChanged', 0, 1, 0.05), ...slider('Same folder', s.weights, 'sameDir', 0, 1, 0.05), ...slider('Min score', s, 'minScore', 0, 1, 0.05), ...slider('Cards per trigger', s, 'cardsPerTrigger', 1, 5, 1)),
        el('h3', {}, 'Delivery'), el('div', { class: 'row' }, ...['knowledge', 'work'].map((m) => el('label', { class: 'row small' }, el('input', { type: 'radio', name: 'deliv', checked: s.delivery === m, onchange: () => { s.delivery = m; run(); } }), m === 'knowledge' ? 'Knowledge items (decisions, problems, facts)' : 'Work summaries (v1)'))),
        el('h3', {}, 'Card shows (work summaries)'), el('div', { class: 'row' }, check('decisions', 'decisions'), check('problems', 'problems'), check('facts', 'facts')),
        el('div', { class: 'row', style: 'margin-top:14px' }, el('button', { class: 'primary', onclick: async () => { await post('settings', { weights: s.weights, minScore: s.minScore, cardsPerTrigger: s.cardsPerTrigger, show: s.show, delivery: s.delivery }); toast('saved as defaults'); } }, 'Save as defaults')))));
  if (S.pv.input) run();
}

// ── Activity ─────────────────────────────────────────────────────────────
async function activity() {
  const a = await api('activity', { limit: 300 });
  const evRows = a.hooks.map((h) => el('tr', {}, el('td', { class: 'small' }, fmtDate(h.ts)), el('td', {}, h.event === 'UserPromptSubmit' ? 'prompt' : h.tool || h.event),
    el('td', { class: 'mono small' }, short(h.target.replace(/file:/g, ''), 70) || '—'),
    el('td', {}, h.cards.length ? h.cards.map((c) => el('div', {}, el('a', { onclick: () => { S.sel = c.work; setView('memory'); } }, c.work), el('span', { class: 'small muted' }, ` ${c.score} · ${c.via}`))) : el('span', { class: 'muted' }, 'silent')),
    el('td', { class: 'small' }, `${h.ms} ms`), el('td', { class: 'small' }, h.chars), el('td', {}, h.shadow ? el('span', { class: 'pill warn' }, 'shadow') : '')));
  fill(main, el('h1', {}, 'Activity'), el('p', { class: 'sub' }, 'Every hook trigger: what the agent touched, what memory was injected (or would have been, in shadow mode), and how long it took. Refreshes every 5 s.'),
    el('div', { class: 'panel' }, el('table', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Trigger'), el('th', {}, 'Target'), el('th', {}, 'Injected'), el('th', {}, 'Time'), el('th', {}, 'Chars'), el('th', {}, '')), ...(evRows.length ? evRows : [el('tr', {}, el('td', { colspan: 7, class: 'empty' }, 'No hook events yet. Start a Claude session with the hook loaded.'))]))),
    el('div', { class: 'grid two', style: 'margin-top:14px' },
      el('div', { class: 'panel' }, el('h2', {}, 'Extraction / backfill log'), el('pre', { class: 'mono small', style: 'white-space:pre-wrap' }, a.backfill.join('\n') || '—')),
      el('div', { class: 'panel' }, el('h2', {}, 'Live sync log'), el('pre', { class: 'mono small', style: 'white-space:pre-wrap' }, a.sync.join('\n') || '—'))));
  clearTimeout(S.actTimer);
  S.actTimer = setTimeout(() => { if (S.view === 'activity') activity(); }, 5000);
}

// ── Team ─────────────────────────────────────────────────────────────────
async function team() {
  const t = await api('team');
  const save = async () => { await post('team', { org: t.org, members: t.members, teams: t.teams }); toast('team saved'); team(); };
  const known = new Map((t.members || []).map((m) => [m.email.toLowerCase(), m]));
  for (const p of t.people || []) if (!known.has(String(p.email).toLowerCase())) known.set(String(p.email).toLowerCase(), { name: who(p.email), email: p.email, role: 'member', fromSessions: true, works: p.works });
  for (const p of t.people || []) { const m = known.get(String(p.email).toLowerCase()); if (m) m.works = p.works; }
  const name = el('input', { placeholder: 'Name' }), email = el('input', { placeholder: 'email@company.com', type: 'email' });
  const role = el('select', {}, el('option', { value: 'member' }, 'member'), el('option', { value: 'owner' }, 'owner'), el('option', { value: 'viewer' }, 'viewer'));
  const newTeam = el('input', { placeholder: 'New team name' });
  fill(main, el('h1', {}, 'Team'), el('p', { class: 'sub' }, `Organization: ${t.org}`),
    el('div', { class: 'banner' }, 'V1 runs on this machine only. Members, teams and repo scoping are configured here now; sharing memory between members (sync, access by repo permission) comes in V2.'),
    el('div', { class: 'grid two' },
      el('div', { class: 'panel' }, el('h2', {}, 'Members'),
        el('table', {}, el('tr', {}, el('th', {}, 'Name'), el('th', {}, 'Email'), el('th', {}, 'Role'), el('th', {}, 'Work items'), el('th', {}, '')),
          ...[...known.values()].map((m) => el('tr', {}, el('td', {}, m.name), el('td', { class: 'mono small' }, m.email), el('td', {}, m.role), el('td', {}, m.works ?? 0),
            el('td', {}, m.fromSessions ? el('span', { class: 'small muted' }, 'seen in sessions') : el('button', { class: 'danger', onclick: () => { t.members = t.members.filter((x) => x.email !== m.email); save(); } }, 'Remove'))))),
        el('h3', {}, 'Add member'), el('div', { class: 'row' }, name, email, role, el('button', { class: 'primary', onclick: () => {
          if (!email.value.includes('@')) return toast('enter an email');
          t.members = [...(t.members || []).filter((x) => x.email !== email.value), { name: name.value || who(email.value), email: email.value, role: role.value, addedAt: new Date().toISOString() }]; save();
        } }, 'Add'))),
      el('div', { class: 'panel' }, el('h2', {}, 'Repos in scope'), el('p', { class: 'small muted' }, 'Excluded repos are never injected (takes effect immediately). Extraction of new sessions still sees them; exclude here to stop showing them.'),
        el('table', {}, el('tr', {}, el('th', {}, 'Repo'), el('th', {}, 'Clones'), el('th', {}, 'Work items'), el('th', {}, 'Include')),
          ...(t.repos || []).map((r) => el('tr', {}, el('td', { class: 'mono small' }, r.slug), el('td', {}, r.clones ?? 0), el('td', {}, r.works),
            el('td', {}, toggle(r.include, async (on) => { const s = await api('settings'); s.repos[r.slug] = { include: on }; await post('settings', { repos: s.repos }); toast(`${r.slug} ${on ? 'included' : 'excluded'}`); }))))))),
    el('div', { class: 'panel', style: 'margin-top:14px' }, el('h2', {}, 'Teams'),
      ...(t.teams || []).map((tm, i) => el('div', { class: 'rec' }, el('div', { class: 'row' }, el('b', {}, tm.name), el('button', { class: 'danger right', onclick: () => { t.teams.splice(i, 1); save(); } }, 'Delete team')),
        el('div', { class: 'small muted' }, 'Repos this team shares memory for:'),
        el('div', { class: 'row' }, ...(t.repos || []).map((r) => el('label', { class: 'row small' }, el('input', { type: 'checkbox', checked: tm.repos.includes(r.slug), onchange: (e) => { tm.repos = e.target.checked ? [...tm.repos, r.slug] : tm.repos.filter((x) => x !== r.slug); save(); } }), r.slug.split('/').pop()))),
        el('div', { class: 'small muted', style: 'margin-top:6px' }, 'Members:'),
        el('div', { class: 'row' }, ...[...known.values()].map((m) => el('label', { class: 'row small' }, el('input', { type: 'checkbox', checked: tm.members.includes(m.email), onchange: (e) => { tm.members = e.target.checked ? [...tm.members, m.email] : tm.members.filter((x) => x !== m.email); save(); } }), m.name))))),
      el('div', { class: 'row', style: 'margin-top:10px' }, newTeam, el('button', { class: 'primary', onclick: () => { if (!newTeam.value.trim()) return; t.teams = [...(t.teams || []), { name: newTeam.value.trim(), repos: [], members: [] }]; save(); } }, 'Create team'))));
}

function toggle(on, onchange) {
  const inp = el('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) });
  return el('label', { class: 'toggle' }, inp, el('span'));
}

// ── Settings ─────────────────────────────────────────────────────────────
async function settings({ meta }) {
  const s = structuredClone(meta.settings);
  const sw = (label, hint, get, set) => el('div', { class: 'switch' }, el('div', {}, el('div', { class: 'lbl' }, label), el('div', { class: 'hint' }, hint)), toggle(get(), (v) => { set(v); }));
  const num = (label, hint, obj, key, min, max, step = 1) => el('div', { class: 'switch' }, el('div', {}, el('div', { class: 'lbl' }, label), el('div', { class: 'hint' }, hint)),
    el('input', { type: 'number', min, max, step, value: obj[key], style: 'width:90px', onchange: (e) => { obj[key] = Number(e.target.value); } }));
  fill(main, el('h1', {}, 'Settings'), el('p', { class: 'sub' }, 'Read by the hook on every trigger — changes apply to running Claude sessions immediately.'),
    el('div', { class: 'grid two' },
      el('div', { class: 'panel' }, el('h2', {}, 'Delivery'),
        sw('Memory enabled', 'Master switch. Off = the hook does nothing (kill switch).', () => s.enabled, (v) => (s.enabled = v)),
        sw('Shadow mode', 'Compute and log what would be injected, but inject nothing. Use this to watch quality first.', () => s.shadow, (v) => (s.shadow = v)),
        sw('On prompt', 'Only fires when the prompt names a file or code identifier — never on general wording.', () => s.triggers.prompt, (v) => (s.triggers.prompt = v)),
        sw('When the agent opens a file', 'First Read of each file per session.', () => s.triggers.read, (v) => (s.triggers.read = v)),
        sw('When the agent edits a file', 'First Edit/Write of each file per session.', () => s.triggers.edit, (v) => (s.triggers.edit = v)),
        sw('When a command or tool fails', 'Shows problems the team already solved with a similar error (only resolved ones, strict match).', () => s.triggerOnFailure, (v) => (s.triggerOnFailure = v)),
        el('div', { class: 'switch' }, el('div', {}, el('div', { class: 'lbl' }, 'Delivery'), el('div', { class: 'hint' }, 'Knowledge items = specific decisions, problems, facts and config history (v1.3). Work summaries = v1 cards (did not improve outcomes in T7).')),
          el('select', { onchange: (e) => (s.delivery = e.target.value) }, el('option', { value: 'knowledge', selected: s.delivery === 'knowledge' ? true : undefined }, 'knowledge items'), el('option', { value: 'work', selected: s.delivery === 'work' ? true : undefined }, 'work summaries'))),
        num('Items per trigger', 'Knowledge items injected per trigger.', s, 'itemsPerTrigger', 1, 8),
        num('Cards per trigger', 'Evidence: more injected items tends to hurt; 1–2 is best.', s, 'cardsPerTrigger', 1, 5),
        num('Max cards per session', 'Hard budget across the whole session.', s, 'maxCardsPerSession', 1, 30),
        num('Min score', 'Cards below this graph score are never shown.', s, 'minScore', 0, 1, 0.05),
        num('Min significance', 'The extractor rates each work item 1–5. Items below this are browsable here but never injected.', s, 'minSignificance', 1, 5)),
      el('div', { class: 'panel' }, el('h2', {}, 'Ranking weights'), el('p', { class: 'small muted' }, 'How strongly each graph path ties past work to the file being touched. Tune these live on “What Claude sees”.'),
        ...Object.keys(s.weights).map((k) => num(k, '', s.weights, k, 0, 1, 0.05)),
        el('h2', { style: 'margin-top:16px' }, 'Card content'),
        sw('Decisions', '', () => s.show.decisions, (v) => (s.show.decisions = v)), sw('Problems', '', () => s.show.problems, (v) => (s.show.problems = v)), sw('Facts', 'Only facts whose code has not changed since.', () => s.show.facts, (v) => (s.show.facts = v)),
        el('h2', { style: 'margin-top:16px' }, 'Extraction'),
        el('div', { class: 'switch' }, el('div', {}, el('div', { class: 'lbl' }, 'Model'), el('div', { class: 'hint' }, 'Used for new chunks. Changing it re-extracts on the next run.')),
          el('select', { onchange: (e) => (s.extraction.model = e.target.value) }, ...['haiku', 'sonnet'].map((m) => el('option', { value: m, selected: s.extraction.model === m ? true : undefined }, m)))),
        num('Parallel calls', '', s.extraction, 'concurrency', 1, 12))),
    el('div', { class: 'row', style: 'margin-top:14px' }, el('button', { class: 'primary', onclick: async () => { await post('settings', s); toast('settings saved'); render(); } }, 'Save settings'), el('span', { class: 'small muted' }, 'Repos in scope are managed on the Team page.')));
}

// ── Shared: thumbs up/down on a card (feeds ranking) ─────────────────────
function voteButtons(work, session, target, current, onDone) {
  const box = el('span', { class: 'vote' });
  const draw = (cur) => fill(box,
    el('button', { class: `up ${cur === 'up' ? 'on' : ''}`, title: 'useful for that work', onclick: () => send(cur === 'up' ? 'clear' : 'up') }, '👍'),
    el('button', { class: `down ${cur === 'down' ? 'on' : ''}`, title: 'not useful / noise', onclick: () => send(cur === 'down' ? 'clear' : 'down') }, '👎'));
  const send = async (vote) => { await post('feedback', { work, vote, session, target }); draw(vote === 'clear' ? null : vote); toast(vote === 'clear' ? 'vote cleared' : 'thanks — ranking updated'); onDone?.(); };
  draw(current);
  return box;
}
const spanText = (a, b) => { const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };
const projectLabel = (p) => String(p || '').replace(/^-Users-[^-]+-Desktop-/, '').replace(/^workspace-?/, '') || 'workspace';

// ── Sessions ─────────────────────────────────────────────────────────────
async function sessions() {
  const list = await api('sessions');
  const box = el('div', { class: 'panel detail' }, el('div', { class: 'empty' }, 'Select a session to see what memory captured from it, in order.'));
  const rows = list.map((s) => el('tr', { style: 'cursor:pointer', onclick: () => showSession(s.id, box) },
    el('td', { class: 'small', style: 'white-space:nowrap' }, fmtDate(s.started), el('div', { class: 'muted' }, spanText(s.started, s.ended))), el('td', { class: 'mono small' }, projectLabel(s.project)),
    el('td', {}, s.works), el('td', {}, s.sig ? `★${s.sig}` : '—'), el('td', { class: 'mono small' }, s.repos.map((r) => r.split('/').pop()).join(', ')),
    el('td', {}, s.excluded ? el('span', { class: 'pill bad' }, 'excluded') : '')));
  fill(main, el('h1', {}, 'Sessions'), el('p', { class: 'sub' }, 'Every Claude Code session memory was built from. Open one to see its work items in order; exclude test or private sessions.'),
    el('div', { class: 'split' }, el('div', { class: 'panel' }, el('table', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Folder'), el('th', {}, 'Work'), el('th', {}, 'Avg ★'), el('th', {}, 'Repos'), el('th', {}, '')), ...rows)), box));
  if (S.selSession) showSession(S.selSession, box);
}
async function showSession(id, box) {
  S.selSession = id;
  const s = await api('session', { id });
  fill(box, el('div', { class: 't' }, `Session ${id.slice(0, 8)}`), el('div', { class: 'mono small muted' }, id),
    el('div', { class: 'row', style: 'margin:10px 0' }, el('span', { class: 'pill' }, `${s.works.length} work items`), s.excluded ? el('span', { class: 'pill bad' }, 'excluded') : null,
      el('button', { class: s.excluded ? '' : 'danger', onclick: async () => {
        if (!s.excluded && !confirm('Exclude this session from memory? Its work items disappear after the next graph rebuild, and it is never extracted again.')) return;
        await post('exclude-session', { id, exclude: !s.excluded }); toast(s.excluded ? 'session included again' : 'session excluded — rebuild the graph to apply'); showSession(id, box);
      } }, s.excluded ? 'Include again' : 'Exclude session'),
      el('button', { onclick: async () => { const r = await post('action', { action: 'build' }); toast(r.error || 'rebuilding graph — see Activity'); } }, 'Rebuild graph')),
    el('div', { class: 'timeline' }, ...s.works.map((w) => el('div', { class: 'item', onclick: () => { S.sel = w.id; setView('memory'); } },
      el('div', { class: 't' }, w.title), el('div', { class: 'm' }, el('span', {}, `P${w.prompts?.[0]}–P${w.prompts?.[1]}`), el('span', {}, fmtDate(w.ended)), statusPill(w.status), verifPill(w.verification), w.significance ? el('span', { class: 'pill' }, `★${w.significance}`) : null),
      el('div', { class: 'd' }, w.what_was_done)))));
}

// ── Files ────────────────────────────────────────────────────────────────
async function files() {
  const input = el('input', { type: 'search', placeholder: 'Find a file (name or path)…', style: 'width:460px' });
  const sugg = el('div', { class: 'suggest', style: 'display:none' });
  const box = el('div');
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => {
    if (input.value.length < 2) { sugg.style.display = 'none'; return; }
    const res = (await api('find', { q: input.value })).filter((r) => r.type === 'File');
    fill(sugg, res.map((r) => el('div', { onclick: () => { sugg.style.display = 'none'; S.fileSel = r.id; showFile(r.id, box); } }, fileLabel(r.id))));
    sugg.style.display = res.length ? 'block' : 'none';
  }, 200); });
  fill(main, el('h1', {}, 'Files'), el('p', { class: 'sub' }, 'The history of a file: who worked on it, what was decided, what broke, what is known about it, and what usually changes with it.'),
    el('div', { class: 'row', style: 'position:relative' }, input), sugg, box);
  if (S.fileSel) return showFile(S.fileSel, box);
  const top = await api('top-files');
  fill(box, el('div', { class: 'panel', style: 'margin-top:14px' }, el('h2', {}, 'Most worked-on files'),
    el('table', {}, el('tr', {}, el('th', {}, 'File'), el('th', {}, 'Work items'), el('th', {}, 'Last worked on')),
      ...top.map((f) => el('tr', { style: 'cursor:pointer', onclick: () => { S.fileSel = f.id; showFile(f.id, box); } }, el('td', { class: 'mono small' }, fileLabel(f.id)), el('td', {}, f.works), el('td', { class: 'small' }, fmtDate(f.last)))))));
}
async function showFile(id, box) {
  const f = await api('file', { id });
  if (!f) { fill(box, el('div', { class: 'empty' }, 'Not in the graph.')); return; }
  const kind = { Decision: 'decision', Problem: 'problem', Fact: 'fact' };
  fill(box, el('div', { class: 'panel', style: 'margin-top:14px' },
    el('div', { class: 'row' }, el('div', { class: 't', style: 'font-size:16px;font-weight:700' }, f.rel), el('span', { class: 'pill' }, f.slug),
      el('div', { class: 'right row' }, el('button', { onclick: () => { S.pv = { mode: 'file', input: id }; setView('preview'); } }, 'What Claude sees here'), el('button', { onclick: () => { S.graphStart = id; setView('graph'); } }, 'Open in graph'))),
    el('div', { class: 'grid two', style: 'margin-top:12px' },
      el('div', {}, el('h3', {}, `Past work (${f.works.length})`),
        f.works.length ? el('div', { class: 'timeline' }, ...f.works.map((w) => el('div', { class: `item ${w.hidden ? 'hidden' : ''}`, onclick: () => { S.sel = w.id; setView('memory'); } },
          el('div', { class: 't' }, w.title), el('div', { class: 'm' }, el('span', {}, fmtDate(w.ended)), el('span', {}, who(w.person)), el('span', { class: 'pill' }, w.rel === 'TOUCHED' ? 'changed it' : 'used it'), verifPill(w.verification), w.significance ? el('span', { class: 'pill' }, `★${w.significance}`) : null),
          el('div', { class: 'd' }, w.what_was_done)))) : el('div', { class: 'muted' }, 'No recorded work.')),
      el('div', {}, el('h3', {}, `Known about this file (${f.about.length})`),
        ...(f.about.length ? f.about.slice(0, 20).map((k) => el('div', { class: `rec ${kind[k.type] || ''}` }, el('div', {}, el('b', {}, k.type), ' ', k.statement || k.choice || k.symptom, ' ', k.status && k.type === 'Fact' ? factPill(k.status) : k.file_status === 'changed_since' ? factPill('changed_since') : ''),
          k.why ? el('div', { class: 'small muted' }, `Why: ${k.why}`) : null, k.resolution ? el('div', { class: 'small muted' }, `Resolution: ${k.resolution}`) : null)) : [el('div', { class: 'muted' }, 'Nothing recorded yet.')]),
        el('h3', {}, 'Usually changes with'),
        f.cochanged.length ? el('div', { class: 'files' }, ...f.cochanged.map((c) => el('span', { class: 'file', title: `${c.commits} commits together`, onclick: () => { S.fileSel = c.id; showFile(c.id, box); } }, `${c.id.split('/').pop()} ×${c.commits}`))) : el('div', { class: 'muted small' }, 'No co-change history.')))));
}

// ── Shadow review ────────────────────────────────────────────────────────
async function shadow() {
  const d = await api('shadow', { limit: 150 });
  const st = d.stats;
  const rated = st.up + st.down;
  const evs = d.events.map((e) => el('div', { class: 'event' },
    el('div', { class: 'head' }, el('b', {}, fmtDate(e.ts)), el('span', { class: 'pill' }, e.event === 'UserPromptSubmit' ? 'prompt' : `${e.tool || ''} file`),
      el('span', { class: 'mono' }, short(e.target.replace(/file:/g, ''), 90) || '—'), el('span', {}, `session ${String(e.session).slice(0, 8)}`), el('span', {}, `${e.ms} ms`),
      e.shadow ? el('span', { class: 'pill warn' }, 'shadow — not injected') : el('span', { class: 'pill ok' }, 'injected')),
    ...e.cards.map((c) => el('div', { class: 'card' },
      el('div', { class: 'row' }, el('a', { onclick: () => { S.sel = c.work; setView('memory'); } }, el('b', {}, c.title)), el('span', { class: 'small muted' }, `${c.via} · score ${c.score}${c.significance ? ` · ★${c.significance}` : ''}`),
        el('span', { class: 'right' }, voteButtons(c.work, e.session, e.target, c.vote))),
      c.what ? el('div', { class: 'small muted', style: 'margin-top:4px' }, short(c.what, 260)) : null))));
  fill(main, el('h1', {}, 'Shadow review'), el('p', { class: 'sub' }, 'Every card the hook would have shown in real sessions. Rate them: 👍 = would have helped that work, 👎 = noise. Votes adjust ranking immediately (two 👎 and no 👍 removes a card).'),
    el('div', { class: 'grid kpis' },
      el('div', { class: 'panel kpi' }, el('div', { class: 'v' }, st.events), el('div', { class: 'l' }, 'triggers with cards')),
      el('div', { class: 'panel kpi' }, el('div', { class: 'v' }, st.cards), el('div', { class: 'l' }, 'cards')),
      el('div', { class: 'panel kpi' }, el('div', { class: 'v' }, rated), el('div', { class: 'l' }, 'rated')),
      el('div', { class: 'panel kpi' }, el('div', { class: 'v' }, rated ? `${Math.round((100 * st.up) / rated)}%` : '—'), el('div', { class: 'l' }, 'rated useful'))),
    el('div', { style: 'margin-top:14px' }, ...(evs.length ? evs : [el('div', { class: 'panel empty' }, 'No would-inject events yet. Work in a company repo with Claude Code and they appear here.')])));
}

render();
