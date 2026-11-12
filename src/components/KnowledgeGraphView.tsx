import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Maximize, Minus, Plus } from 'lucide-react';
import type { OfficeNote } from '../types';
import { useAgents } from '../agents';
import { knowledgeGraph, type KnowledgeGraphNode } from '../../server/knowledge.mjs';
import { forceLayout, layoutBounds } from './forceLayout';

const NOTE_DEFAULT = '#8b82ff', TAG = '#e0a33a', FILE = '#3ea7a0';
const LINK_LENGTH = { tag: 115, file: 130 } as const;
const MIN_SCALE = .35, MAX_SCALE = 5;

const radius = (node: KnowledgeGraphNode) => node.kind === 'note' ? 9 + Math.min(8, node.degree * 1.2) : 5 + Math.min(7, node.degree * 1.4);
const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;

/**
 * A graphify-style view of the team knowledge: notes (coloured by the agent
 * who wrote them) linked to the tags and files they mention. Drag to pan,
 * scroll to zoom, hover to trace connections, click a note to open it.
 */
export function KnowledgeGraphView({ notes, matches, selectedNote, onSelectNote }: {
  notes: OfficeNote[];
  /** Node ids matching the current search, or null when not searching. */
  matches: Set<string> | null;
  selectedNote: string | null;
  onSelectNote: (noteId: string | null) => void;
}) {
  const agents = useAgents();
  const graph = useMemo(() => knowledgeGraph(notes), [notes]);
  const points = useMemo(() => forceLayout(
    graph.nodes.map(node => ({ id: node.id, weight: node.degree })),
    graph.links.map(link => ({ ...link, length: LINK_LENGTH[link.target.startsWith('tag:') ? 'tag' : 'file'] })),
  ), [graph]);
  const bounds = useMemo(() => layoutBounds(points.values()), [points]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { source, target } of graph.links) {
      if (!map.has(source)) map.set(source, new Set());
      if (!map.has(target)) map.set(target, new Set());
      map.get(source)!.add(target); map.get(target)!.add(source);
    }
    return map;
  }, [graph]);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; node: string | null } | null>(null);

  // A new graph (notes added or removed) starts from the fitted view.
  const [graphKey, setGraphKey] = useState(graph);
  if (graphKey !== graph) { setGraphKey(graph); setView({ scale: 1, x: 0, y: 0 }); setFocus(null); }

  const toGraph = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  };
  const zoom = (factor: number, around?: { x: number; y: number }) => setView(current => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
    const anchor = around ?? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    // Keep the point under the cursor fixed while scaling.
    const ratio = scale / current.scale;
    return { scale, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio };
  });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, toGraph(event.clientX, event.clientY)); };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    // Remember the pressed node now: pointer capture retargets the release to the <svg>.
    const pressed = (event.target as Element).closest<SVGGElement>('[data-node]')?.dataset.node ?? null;
    drag.current = { x: event.clientX, y: event.clientY, moved: false, node: pressed };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag.current) return;
    const matrix = svg.current?.getScreenCTM();
    const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
    if (!drag.current.moved && Math.hypot(dx, dy) < 4) return;
    drag.current = { ...drag.current, x: event.clientX, y: event.clientY, moved: true };
    const unit = matrix ? 1 / matrix.a : 1;
    setView(current => ({ ...current, x: current.x + dx * unit, y: current.y + dy * unit }));
  };
  const onPointerUp = () => {
    const press = drag.current;
    drag.current = null;
    if (!press || press.moved) return;
    // A click (not a drag): select the pressed node, or clear on empty space.
    const node = press.node ? graph.nodes.find(item => item.id === press.node) : null;
    if (!node) { setFocus(null); onSelectNote(null); return; }
    if (node.kind === 'note') { setFocus(null); onSelectNote(node.noteId!); }
    else setFocus(current => current === node.id ? null : node.id);
  };

  const selectedId = selectedNote ? `note:${selectedNote}` : null;
  const active = hovered ?? focus ?? selectedId;
  const lit = active ? new Set([active, ...(neighbours.get(active) ?? [])]) : matches;
  const dim = (id: string) => Boolean(lit) && !lit!.has(id);
  const showLabel = (node: KnowledgeGraphNode) => lit?.has(node.id) || view.scale > 1.7 ||
    (node.kind === 'note' ? graph.nodes.length <= 90 : node.degree >= 2 && graph.nodes.length <= 60);
  const colour = (node: KnowledgeGraphNode) => node.kind === 'tag' ? TAG : node.kind === 'file' ? FILE
    : agents.find(agent => agent.id === node.agentId)?.color ?? NOTE_DEFAULT;
  const labelSize = 11 / Math.sqrt(view.scale);
  const labelText = (node: KnowledgeGraphNode) => truncate(node.label, node.kind === 'note' ? 28 : 22);
  // Greedy collision avoidance: highlighted and well-connected nodes claim label
  // space first; a label that would overlap one already placed stays hidden
  // until its node is hovered, selected or zoomed into.
  const labelled = new Set<string>();
  const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const priority = (node: KnowledgeGraphNode) => (lit?.has(node.id) ? 1000 : 0) + (node.kind === 'note' ? 100 : 0) + node.degree;
  for (const node of [...graph.nodes].filter(showLabel).sort((a, b) => priority(b) - priority(a))) {
    const point = points.get(node.id)!, r = radius(node);
    // Label box in screen-independent graph units (the group is scaled by view.scale).
    const width = labelText(node).length * labelSize * .56, top = point.y + r + 2;
    const box = { x1: point.x - width / 2, y1: top, x2: point.x + width / 2, y2: top + labelSize * 1.25 };
    const pad = 2 / view.scale;
    const clash = placed.some(other => box.x1 < other.x2 + pad && box.x2 > other.x1 - pad && box.y1 < other.y2 + pad && box.y2 > other.y1 - pad);
    if (clash && !(node.id === hovered || node.id === selectedId)) continue;
    labelled.add(node.id); placed.push(box);
  }

  return <div className="kg-canvas">
    <svg ref={svg} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img"
      aria-label={`Knowledge graph: ${graph.nodes.filter(node => node.kind === 'note').length} notes linked by tags and files`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHovered(null)}>
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        <g className="kg-links">
          {graph.links.map(link => {
            const a = points.get(link.source)!, b = points.get(link.target)!;
            const on = active && (link.source === active || link.target === active);
            return <line key={`${link.source}>${link.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              className={on ? 'on' : dim(link.source) || dim(link.target) ? 'dim' : ''} strokeWidth={(on ? 1.8 : 1) / Math.sqrt(view.scale)}/>;
          })}
        </g>
        {graph.nodes.map(node => {
          const { x, y } = points.get(node.id)!, r = radius(node);
          const classes = ['kg-node', `kg-${node.kind}`, dim(node.id) ? 'dim' : '', node.id === selectedId ? 'selected' : '', node.status === 'draft' ? 'draft' : ''].filter(Boolean).join(' ');
          return <g key={node.id} data-node={node.id} className={classes} transform={`translate(${x} ${y})`}
            onPointerEnter={() => setHovered(node.id)} onPointerLeave={() => setHovered(current => current === node.id ? null : current)}>
            <title>{node.kind === 'file' ? node.path : node.label}</title>
            {node.kind === 'file'
              ? <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * .35} fill={colour(node)}/>
              : <circle r={r} fill={colour(node)}/>}
            {labelled.has(node.id) && <text y={r + labelSize + 2} fontSize={labelSize} textAnchor="middle">{labelText(node)}</text>}
          </g>;
        })}
      </g>
    </svg>
    <div className="kg-controls">
      <button type="button" onClick={() => zoom(1.3)} aria-label="Zoom in"><Plus size={14}/></button>
      <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="Zoom out"><Minus size={14}/></button>
      <button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })} aria-label="Fit graph"><Maximize size={13}/></button>
    </div>
    <div className="kg-legend" aria-hidden="true">
      <span><i className="note"/>Note</span><span><i className="tag"/>Tag</span><span><i className="file"/>File</span><span><i className="draft"/>Draft</span>
    </div>
  </div>;
}
