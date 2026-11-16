import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, OctahedronGeometry, SphereGeometry, Vector3, type Group, type LineBasicMaterial, type Mesh, type MeshBasicMaterial } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Maximize, Minus, Plus, RotateCw } from 'lucide-react';
import type { OfficeNote } from '../types';
import { useAgents } from '../agents';
import { knowledgeGraph, type KnowledgeGraphNode } from '../../server/knowledge.mjs';
import { forceLayout } from './forceLayout';

const NOTE_DEFAULT = '#8b82ff', TAG = '#e0a33a', FILE = '#3ea7a0', DRAFT = '#f2a33a', PROJECT = '#ec6fa6';
const LINK_LENGTH = { tag: 115, file: 130, project: 150 } as const;
const linkKind = (target: string) => target.startsWith('tag:') ? 'tag' : target.startsWith('project:') ? 'project' : 'file';
const UNIT = .022; // Layout units → world units.
const ENTRANCE = 1.1, STAGGER = .45, RESUME_SPIN_MS = 6000;
const LINK = new Color('#7f93b6'), LINK_DIM = new Color('#25324a'), LINK_ON = new Color('#d6e2ff');
const sphere = new SphereGeometry(1, 20, 14), cube = new BoxGeometry(1.6, 1.6, 1.6), diamond = new OctahedronGeometry(1.35);

const radius = (node: KnowledgeGraphNode) => node.kind === 'project' ? .26 + Math.min(.14, node.degree * .012) : node.kind === 'note' ? .13 + Math.min(.13, node.degree * .025) : .09 + Math.min(.1, node.degree * .02);
const truncate = (text: string, max: number) => text.length > max ? text.slice(0, max - 1) + '…' : text;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The geometry's attribute, replaced by a fresh buffer when the vertex count changes. */
function sized(geometry: BufferGeometry, name: 'position' | 'color', vertices: number) {
  const current = geometry.getAttribute(name) as BufferAttribute | undefined;
  if (current && current.count === Math.max(1, vertices)) return current;
  const next = new BufferAttribute(new Float32Array(Math.max(1, vertices) * 3), 3);
  geometry.setAttribute(name, next);
  return next;
}

/** Writes each link's two end points into the line geometry. */
function writeLinks(geometry: BufferGeometry | null, pairs: readonly (readonly [number, number])[], positions: readonly Vector3[]) {
  if (!geometry) return;
  const attribute = sized(geometry, 'position', pairs.length * 2);
  geometry.setDrawRange(0, pairs.length * 2);
  pairs.forEach(([a, b], i) => {
    attribute.setXYZ(i * 2, positions[a].x, positions[a].y, positions[a].z);
    attribute.setXYZ(i * 2 + 1, positions[b].x, positions[b].y, positions[b].z);
  });
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
}

type Layout = { ids: string[]; base: Vector3[]; extent: number; order: number[] };

/**
 * The knowledge graph as a slowly turning 3D cloud: notes (coloured by the agent
 * who wrote them) linked to the tags and files they mention. Drag to orbit,
 * right-drag to pan, scroll to zoom, hover to trace links, click a note to open it.
 * With `projects`, notes also hang off a hub per project; clicking a hub opens that project.
 */
export default function KnowledgeGraph3D({ notes, projects = false, onSelectProject, matches, selectedNote, onSelectNote }: {
  notes: OfficeNote[];
  /** Overall view: add a hub node per project so each project forms its own cluster. */
  projects?: boolean;
  onSelectProject?: (workspace: string) => void;
  /** Node ids matching the current search, or null when not searching. */
  matches: Set<string> | null;
  selectedNote: string | null;
  onSelectNote: (noteId: string | null) => void;
}) {
  const agents = useAgents();
  const graph = useMemo(() => knowledgeGraph(notes, { projects }), [notes, projects]);
  const layout = useMemo<Layout>(() => {
    const points = forceLayout(
      graph.nodes.map(node => ({ id: node.id, weight: node.degree })),
      graph.links.map(link => ({ ...link, length: LINK_LENGTH[linkKind(link.target)] })),
      320, 3,
    );
    const ids = graph.nodes.map(node => node.id);
    const raw = ids.map(id => { const p = points.get(id)!; return new Vector3(p.x, p.y, p.z ?? 0); });
    const centre = raw.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(Math.max(1, raw.length));
    const base = raw.map(p => p.sub(centre).multiplyScalar(UNIT));
    const extent = Math.max(2.5, ...base.map(p => p.length()));
    // Best-connected nodes arrive first.
    const rank = [...graph.nodes.keys()].sort((a, b) => graph.nodes[b].degree - graph.nodes[a].degree);
    const order = new Array<number>(ids.length);
    rank.forEach((nodeIndex, i) => { order[nodeIndex] = rank.length > 1 ? i / (rank.length - 1) : 0; });
    return { ids, base, extent, order };
  }, [graph]);
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const { source, target } of graph.links) {
      if (!map.has(source)) map.set(source, new Set());
      if (!map.has(target)) map.set(target, new Set());
      map.get(source)!.add(target); map.get(target)!.add(source);
    }
    return map;
  }, [graph]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [spinning, setSpinning] = useState(() => !reducedMotion());
  const controls = useRef<OrbitControlsImpl | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);

  // A new graph (notes added or removed) is framed again and plays the entrance.
  const [graphKey, setGraphKey] = useState(graph);
  if (graphKey !== graph) { setGraphKey(graph); setFocus(null); setHovered(null); setSettled(false); }
  useEffect(() => {
    const id = setTimeout(() => setSettled(true), reducedMotion() ? 0 : (ENTRANCE + STAGGER) * 1000);
    return () => clearTimeout(id);
  }, [graph]);

  const cameraDistance = layout.extent * 1.85;
  const fit = () => {
    const current = controls.current;
    if (!current) return;
    current.target.set(0, 0, 0);
    current.object.position.set(0, cameraDistance * .32, cameraDistance);
    current.update();
  };
  useEffect(() => { fit(); }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps -- refit only when the graph changes
  const zoom = (factor: number) => {
    const current = controls.current;
    if (!current) return;
    current.object.position.sub(current.target).multiplyScalar(factor).add(current.target);
    current.update();
  };

  const selectedId = selectedNote ? `note:${selectedNote}` : null;
  const active = hovered ?? focus ?? selectedId;
  const lit = active ? new Set([active, ...(neighbours.get(active) ?? [])]) : matches;
  const dim = (id: string) => Boolean(lit) && !lit!.has(id);
  const colour = (node: KnowledgeGraphNode) => node.kind === 'tag' ? TAG : node.kind === 'file' ? FILE : node.kind === 'project' ? PROJECT
    : agents.find(agent => agent.id === node.agentId)?.color ?? NOTE_DEFAULT;
  // Labels: whatever is highlighted, plus busy tags; everything only while the graph is tiny (3D labels overlap as it turns).
  const showLabel = (node: KnowledgeGraphNode) => settled && (node.kind === 'project' || (lit ? lit.has(node.id)
    : graph.nodes.length <= 14 || (node.kind === 'tag' && node.degree >= 4)));

  const click = (node: KnowledgeGraphNode, event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta > 4) return; // The end of an orbit drag, not a click.
    if (node.kind === 'note') { setFocus(null); onSelectNote(node.noteId!); }
    else if (node.kind === 'project' && onSelectProject) onSelectProject(node.workspace ?? '');
    else setFocus(current => current === node.id ? null : node.id);
  };
  const missed = (event: MouseEvent) => {
    const start = press.current;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    setFocus(null); onSelectNote(null);
  };

  return <div className={`kg-canvas kg-3d${hovered ? ' hovering' : ''}`}
    onPointerDown={event => { press.current = { x: event.clientX, y: event.clientY }; }}
    onPointerLeave={() => setHovered(null)}
    role="img" aria-label={`3D knowledge graph: ${graph.nodes.filter(node => node.kind === 'note').length} notes linked by tags and files${projects ? `, grouped into ${graph.nodes.filter(node => node.kind === 'project').length} projects` : ''}`}>
    <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 50, near: .1, far: 500, position: [0, cameraDistance * .32, cameraDistance] }}
      onPointerMissed={missed}>
      <fog attach="fog" args={['#111b2e', cameraDistance * .9, cameraDistance * 2.4]}/>
      <ambientLight intensity={.9}/>
      <pointLight position={[6, 8, 10]} intensity={60} decay={1.6}/>
      <Scene graph={graph} layout={layout} active={active} dim={dim} colour={colour} selectedId={selectedId}
        showLabel={showLabel} onHover={setHovered} onClick={click}/>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.08} autoRotate={spinning} autoRotateSpeed={.7}
        minDistance={1.5} maxDistance={layout.extent * 8}
        onStart={() => setSpinning(false)}/>
    </Canvas>
    <div className="kg-controls">
      <button type="button" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in"><Plus size={14}/></button>
      <button type="button" onClick={() => zoom(1.3)} aria-label="Zoom out"><Minus size={14}/></button>
      <button type="button" onClick={fit} aria-label="Fit graph"><Maximize size={13}/></button>
      <button type="button" onClick={() => setSpinning(on => !on)} aria-pressed={spinning} aria-label={spinning ? 'Stop rotating' : 'Rotate'}
        className={spinning ? 'on' : ''}><RotateCw size={13}/></button>
    </div>
    <div className="kg-legend" aria-hidden="true">
      <span><i className="note"/>Note</span><span><i className="tag"/>Tag</span><span><i className="file"/>File</span>{projects && <span><i className="project"/>Project</span>}<span><i className="draft"/>Draft</span>
    </div>
    <ResumeSpin spinning={spinning} setSpinning={setSpinning}/>
  </div>;
}

/** After the user stops interacting for a while, the graph starts turning again (unless motion is reduced). */
function ResumeSpin({ spinning, setSpinning }: { spinning: boolean; setSpinning: (on: boolean) => void }) {
  const [paused, setPaused] = useState(false);
  const [wasSpinning, setWasSpinning] = useState(spinning);
  if (wasSpinning !== spinning) { setWasSpinning(spinning); if (wasSpinning && !spinning) setPaused(true); }
  useEffect(() => {
    if (!paused || reducedMotion()) return;
    const id = setTimeout(() => { setPaused(false); setSpinning(true); }, RESUME_SPIN_MS);
    return () => clearTimeout(id);
  }, [paused, setSpinning]);
  return null;
}

function Scene({ graph, layout, active, dim, colour, selectedId, showLabel, onHover, onClick }: {
  graph: ReturnType<typeof knowledgeGraph>; layout: Layout; active: string | null;
  dim: (id: string) => boolean; colour: (node: KnowledgeGraphNode) => string; selectedId: string | null;
  showLabel: (node: KnowledgeGraphNode) => boolean;
  onHover: (update: (current: string | null) => string | null) => void;
  onClick: (node: KnowledgeGraphNode, event: ThreeEvent<MouseEvent>) => void;
}) {
  const groups = useRef<(Group | null)[]>([]);
  const halo = useRef<Mesh>(null);
  const motion = useMemo(() => !reducedMotion(), []);
  const index = useMemo(() => new Map(layout.ids.map((id, i) => [id, i])), [layout]);
  const linkPairs = useMemo(() => graph.links.map(link => [index.get(link.source)!, index.get(link.target)!] as const), [graph, index]);

  // All links in one buffer; links touching the active node also go in a brighter, pulsing overlay.
  const links = useRef<BufferGeometry>(null);
  const highlight = useRef<BufferGeometry>(null);
  const onPairs = useMemo(() => active ? linkPairs.filter(([a, b]) => layout.ids[a] === active || layout.ids[b] === active) : [], [active, linkPairs, layout]);
  const highlightMaterial = useRef<LineBasicMaterial>(null);
  const haloMaterial = useRef<MeshBasicMaterial>(null);
  const started = useRef<{ graph: unknown; at: number } | null>(null);

  // Link colours follow the highlight state.
  useEffect(() => {
    const geometry = links.current;
    if (!geometry) return;
    const colours = sized(geometry, 'color', linkPairs.length * 2);
    linkPairs.forEach(([a, b], i) => {
      const tone = dim(layout.ids[a]) || dim(layout.ids[b]) ? LINK_DIM : LINK;
      colours.setXYZ(i * 2, tone.r, tone.g, tone.b); colours.setXYZ(i * 2 + 1, tone.r, tone.g, tone.b);
    });
    colours.needsUpdate = true;
  });

  useFrame(({ clock }) => {
    const now = clock.getElapsedTime();
    if (started.current?.graph !== graph) started.current = { graph, at: now };
    const time = now - started.current.at;
    const positions = layout.base.map((point, i) => {
      const t = motion ? Math.min(1, Math.max(0, (time - layout.order[i] * STAGGER) / (ENTRANCE - .2))) : 1;
      const spread = motion ? easeOutBack(t) : 1;
      const p = point.clone().multiplyScalar(spread);
      if (motion) { // Gentle drift so the cloud never looks frozen.
        const phase = i * 1.7;
        p.x += Math.sin(time * .55 + phase) * .05; p.y += Math.cos(time * .43 + phase * 1.3) * .05; p.z += Math.sin(time * .37 + phase * .7) * .05;
      }
      const group = groups.current[i];
      if (group) { group.position.copy(p); group.scale.setScalar(Math.min(1, t * 1.6)); }
      return p;
    });
    writeLinks(links.current, linkPairs, positions);
    writeLinks(highlight.current, onPairs, positions);
    if (highlightMaterial.current) highlightMaterial.current.opacity = motion ? .65 + Math.sin(time * 5) * .3 : .9;
    // Selected note: an expanding, fading halo.
    const selected = selectedId ? index.get(selectedId) : undefined;
    if (halo.current && haloMaterial.current) {
      halo.current.visible = selected !== undefined;
      if (selected !== undefined) {
        const cycle = motion ? (time % 1.8) / 1.8 : .3;
        const r = radius(graph.nodes[selected]);
        halo.current.position.copy(positions[selected]);
        halo.current.scale.setScalar(r * (1.2 + cycle * 1.8));
        haloMaterial.current.opacity = .35 * (1 - cycle);
      }
    }
  });

  return <>
    <lineSegments frustumCulled={false}><bufferGeometry ref={links}/><lineBasicMaterial vertexColors transparent opacity={.55} depthWrite={false}/></lineSegments>
    <lineSegments frustumCulled={false}><bufferGeometry ref={highlight}/><lineBasicMaterial ref={highlightMaterial} color={LINK_ON} transparent opacity={.9} depthWrite={false}/></lineSegments>
    <mesh ref={halo} geometry={sphere} visible={false}>
      <meshBasicMaterial ref={haloMaterial} color="#ffffff" transparent opacity={0} depthWrite={false}/>
    </mesh>
    {graph.nodes.map((node, i) => {
      const r = radius(node), faded = dim(node.id), hot = node.id === active || node.id === selectedId, tint = colour(node);
      return <group key={node.id} ref={element => { groups.current[i] = element; }} scale={0}>
        <mesh geometry={node.kind === 'file' ? cube : node.kind === 'project' ? diamond : sphere} scale={r * (hot ? 1.3 : 1)}
          onPointerOver={event => { event.stopPropagation(); onHover(() => node.id); }}
          onPointerOut={() => onHover(current => current === node.id ? null : current)}
          onClick={event => onClick(node, event)}>
          <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={hot ? .85 : .45} roughness={.35} metalness={.1}
            transparent opacity={faded ? .14 : 1} depthWrite={!faded}/>
        </mesh>
        {node.status === 'draft' && <mesh geometry={sphere} scale={r * 1.45}>
          <meshBasicMaterial color={DRAFT} transparent opacity={faded ? .06 : .32} depthWrite={false}/>
        </mesh>}
        {showLabel(node) && <Html center position={[0, -(r + .22), 0]} zIndexRange={[20, 1]} className={`kg3d-label kg3d-${node.kind}${faded ? ' dim' : ''}`}>
          {truncate(node.label, node.kind === 'note' || node.kind === 'project' ? 28 : 22)}
        </Html>}
      </group>;
    })}
  </>;
}
