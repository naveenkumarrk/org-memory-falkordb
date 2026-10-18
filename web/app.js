let graph, snapshot;
const $ = id => document.getElementById(id);
const element = (tag, cls, value) => { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = value; return el; };
async function request(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Request failed'); return result;
}
function draw(data) {
  snapshot = data;
  if (!window.cytoscape) { $('graph').textContent = 'Graph library unavailable. Run npm run build:ui.'; return; }
  const nodes = data.nodes.map(n => ({ data: { id: n.id, label: n.props.rel?.split('/').pop() ?? n.props.title ?? n.props.statement ?? n.props.choice ?? n.props.name ?? n.type, type: n.type, retired: ['superseded','retracted'].includes(n.props.status) ? 1 : 0 } }));
  const edges = data.edges.map((e, i) => ({ data: { id: `edge-${i}`, source: e.src, target: e.dst, label: e.rel } }));
  graph?.destroy();
  graph = cytoscape({ container: $('graph'), elements: [...nodes, ...edges], style: [
    { selector: 'node', style: { 'background-color': '#d8ddd0', width: 24, height: 24, label: 'data(label)', 'font-size': 9, color: '#697261', 'text-valign': 'bottom', 'text-margin-y': 8, 'text-wrap': 'ellipsis', 'text-max-width': 125, 'border-width': 3, 'border-color': '#fff' } },
    { selector: 'node[type="File"]', style: { 'background-color': '#a7bbaa', shape: 'round-rectangle' } },
    { selector: 'node[type="Work"]', style: { 'background-color': '#e2bc83', width: 34, height: 34 } },
    { selector: 'node[type="Fact"]', style: { 'background-color': '#a5cc60', width: 30, height: 30 } },
    { selector: 'node[type="Decision"]', style: { 'background-color': '#b6abcf', width: 30, height: 30 } },
    { selector: 'edge', style: { width: 1, 'line-color': '#d8ddce', 'target-arrow-color': '#d8ddce', 'target-arrow-shape': 'triangle', 'arrow-scale': .5, 'curve-style': 'bezier', label: 'data(label)', 'font-size': 7, color: '#9ba48e', 'text-rotation': 'autorotate', 'text-background-color': '#fff', 'text-background-opacity': .9, 'text-background-padding': '2px' } },
    { selector: '.dimmed', style: { opacity: .22 } },
    { selector: '.highlighted', style: { opacity: 1, 'line-color': '#6f9044', 'target-arrow-color': '#6f9044', 'border-color': '#d5e9b4', width: 3 } },
    { selector: 'node.highlighted', style: { width: 34, height: 34, 'border-width': 5 } },
    { selector: 'node[retired=1]', style: { opacity: .35, 'border-style': 'dashed' } },
  ], layout: { name: 'breadthfirst', directed: false, roots: ['file:demo/commerce:src/authentication.ts'], spacingFactor: 1.12, padding: 28 }, minZoom: .4, maxZoom: 2 });
}
function highlight(item) {
  if (!graph) return;
  graph.elements().addClass('dimmed').removeClass('highlighted');
  for (const id of item.path.nodes) graph.getElementById(id).removeClass('dimmed').addClass('highlighted');
  for (let i=0;i<item.path.relations.length;i++) {
    const a=item.path.nodes[i], b=item.path.nodes[i+1], rel=item.path.relations[i];
    graph.edges().filter(e => e.data('label')===rel && ((e.data('source')===a && e.data('target')===b)||(e.data('source')===b && e.data('target')===a))).removeClass('dimmed').addClass('highlighted');
  }
}
async function recall(event) {
  event?.preventDefault(); $('recall').disabled=true; $('evidence').replaceChildren();
  try {
    const result = await request('/demo/recall', { query: $('query').value, graph_expansion: $('expansion').checked });
    $('metrics').textContent=`${result.items.length} memories · ${result.ms} ms server retrieval`;
    $('chars').textContent=`${result.chars} characters`; $('context').textContent=result.context || '(No relevant eligible memory.)';
    $('query-count').textContent=`${result.trace.length} read queries · ${result.backend}`;
    $('queries').textContent=result.trace.map((q,i)=>`Query ${i+1} · ${q.rows} returned rows · ${q.ms} ms\n${q.cypher}\n\nParameters:\n${JSON.stringify(q.params,null,2)}`).join('\n\n────────────────────────────────────\n\n');
    if (!result.items.length) $('evidence').append(element('p','empty','No eligible memory found. Try a specific file, or enable graph traversal to follow the connection through past work.'));
    for (const item of result.items) {
      const card=element('button','memory-card');card.type='button';
      const meta=element('div','card-meta');meta.append(element('span','',item.type),element('span','',item.verification.level.replaceAll('_',' ')));card.append(meta);
      card.append(element('h4','',item.text),element('div','source',item.source.locator),element('div','evidence-quote',`“${item.source.excerpt}”`),element('div','path',item.path.nodes.join(' → ')));
      card.onclick=()=>{ document.querySelectorAll('.memory-card').forEach(c=>c.classList.remove('active'));card.classList.add('active');highlight(item); };
      $('evidence').append(card);
    }
    for (const warning of result.warnings) $('evidence').append(element('div','warning',warning));
    if(result.items.length) { $('evidence').querySelector('button').click(); }
  } catch(error) { $('evidence').append(element('div','warning',error.message)); }
  finally { $('recall').disabled=false; }
}
async function refresh() {
  try {
    const [health,data,outcomes]=await Promise.all([request('/health'),request('/demo/graph'),request('/demo/outcomes')]);
    $('health').textContent=health.ok ? `FalkorDB connected · ${data.nodes.length} nodes / ${data.edges.length} edges` : 'Database unavailable'; draw(data);
    $('outcomes').replaceChildren();
    const run=outcomes.runs?.[0];
    if(run) {
      const row=element('div','run');
      for (const [label,exit] of [['Proposed removal',run.removal_exit],['Compatibility patch',run.compatible_exit]]) {
        const result=element('div','result');result.append(element('span','',label),element('strong',exit===0?'pass':'fail',exit===0?'PASS':'FAIL'),element('span','',`test process exit ${exit}`));row.append(result);
      }
      $('outcomes').append(row,element('div','run-time',`${run.check_id} · ${new Date(run.recorded_at).toLocaleString()}`));
      const details=element('details','context');details.append(element('summary','','Inspect client-reported test output'),element('pre','',run.output));$('outcomes').append(details);
    } else $('outcomes').append(element('p','empty','Run npm run demo:agent, then refresh to inspect its real test outcomes.'));
    if(!data.nodes.length) $('evidence').replaceChildren(element('p','empty','The database is connected. Run npm run demo:seed to load synthetic memory.'));
  } catch(error) { $('health').textContent='Setup required'; $('evidence').replaceChildren(element('div','warning',error.message)); }
}
$('recall-form').addEventListener('submit',recall);$('refresh').addEventListener('click',refresh);
refresh();
