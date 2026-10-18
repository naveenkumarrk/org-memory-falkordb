import { validateSnapshot } from './schema.ts';
import type { Snapshot } from './schema.ts';

// Local publishers retain teammates' nodes and cannot silently resurrect retired knowledge.
export function mergeSnapshot(current: { version: string; nodes: any[]; edges: any[] }, local: Snapshot): Snapshot {
  const nodes = new Map(current.nodes.map(n => [n.id, { id: n.id, type: n.type, props: n.props, ...(n.source ? { source: n.source } : {}) }]));
  const updated = new Set<string>();
  for (const node of local.nodes) {
    const previous = nodes.get(node.id);
    if (previous && ['superseded', 'retracted'].includes(previous.props.status) && !['superseded', 'retracted'].includes((node.props as any).status)) continue;
    nodes.set(node.id, node); updated.add(node.id);
  }
  const edges = new Map<string, Snapshot['edges'][number]>();
  for (const edge of [...current.edges.filter(e => !updated.has(e.src)), ...local.edges])
    edges.set(JSON.stringify([edge.src, edge.rel, edge.dst]), edge);
  return validateSnapshot({ repository: local.repository, expected_version: current.version, nodes: [...nodes.values()], edges: [...edges.values()] });
}
