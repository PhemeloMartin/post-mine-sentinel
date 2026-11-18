import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { GATEWAYS, NODES, type Vec3 } from '@/sim/layout';
import type { Fix, NodeState } from '@/sim/engine';
import { simHolder } from '@/store/sim';

const RIPPLES = 48;
const PACKETS = 72;
const RIPPLE_REAL_S = 1.6;
const HOP_REAL_S = 0.7;

const CLASS_COLOR: Record<string, string> = {
  footsteps: '#f87171',
  digging: '#fb923c',
  machinery: '#facc15',
  blast: '#ffffff',
  vehicle: '#a78bfa',
  animal: '#4ade80',
  background: '#64748b',
};
const KIND_COLOR: Record<string, string> = {
  seismic: '#f87171',
  benign: '#4ade80',
  pir: '#fbbf24',
  tamper: '#e879f9',
  heartbeat: '#38bdf8',
  jam: '#e879f9',
};

const POS: Map<string, Vec3> = new Map([...NODES.map((n) => [n.id, n.pos] as const), ...GATEWAYS.map((g) => [g.id, g.pos] as const)]);

/** Seismic wavefront rings and packets hopping along the SilkNet tree, animated in real time. */
export function Effects() {
  const rings = useRef<(THREE.Mesh | null)[]>([]);
  const packets = useRef<(THREE.Mesh | null)[]>([]);
  const live = useRef<{ ripples: { slot: number; start: number; strength: number }[]; hops: { slot: number; start: number; a: Vec3; b: Vec3 }[]; lastRipple: number; lastHop: number; nextR: number; nextP: number }>({
    ripples: [],
    hops: [],
    lastRipple: 0,
    lastHop: 0,
    nextR: 0,
    nextP: 0,
  });

  useFrame(() => {
    const sim = simHolder.current;
    if (!sim) return;
    const now = performance.now() / 1000;
    const L = live.current;
    // Detect a new simulation run (ids restart) and reset cursors.
    const maxR = sim.state.ripples.at(-1)?.id ?? 0;
    const maxH = sim.state.hops.at(-1)?.id ?? 0;
    if (maxR < L.lastRipple || maxH < L.lastHop) {
      L.lastRipple = 0;
      L.lastHop = 0;
    }
    for (const r of sim.state.ripples) {
      if (r.id <= L.lastRipple) continue;
      L.lastRipple = r.id;
      const slot = L.nextR++ % RIPPLES;
      const mesh = rings.current[slot];
      if (!mesh) continue;
      L.ripples = L.ripples.filter((x) => x.slot !== slot);
      L.ripples.push({ slot, start: now, strength: r.strength });
      mesh.position.set(r.pos.x, r.underground ? r.pos.y : 0.15, r.pos.z);
      (mesh.material as THREE.MeshBasicMaterial).color.set(CLASS_COLOR[r.cls] ?? '#ffffff');
    }
    for (const h of sim.state.hops) {
      if (h.id <= L.lastHop) continue;
      L.lastHop = h.id;
      if (!h.ok) continue;
      const a = POS.get(h.from);
      const b = POS.get(h.to);
      if (!a || !b) continue;
      const slot = L.nextP++ % PACKETS;
      const mesh = packets.current[slot];
      if (!mesh) continue;
      L.hops = L.hops.filter((x) => x.slot !== slot);
      L.hops.push({ slot, start: now, a, b });
      (mesh.material as THREE.MeshBasicMaterial).color.set(KIND_COLOR[h.kind] ?? '#38bdf8');
    }
    L.ripples = L.ripples.filter((r) => {
      const mesh = rings.current[r.slot];
      const k = (now - r.start) / RIPPLE_REAL_S;
      if (!mesh) return false;
      if (k >= 1) {
        mesh.visible = false;
        return false;
      }
      mesh.visible = true;
      mesh.scale.setScalar(1 + k * 40 * (0.4 + r.strength));
      (mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      return true;
    });
    L.hops = L.hops.filter((h) => {
      const mesh = packets.current[h.slot];
      const k = (now - h.start) / HOP_REAL_S;
      if (!mesh) return false;
      if (k >= 1) {
        mesh.visible = false;
        return false;
      }
      mesh.visible = true;
      const arcY = Math.sin(Math.PI * k) * 4;
      mesh.position.set(h.a.x + (h.b.x - h.a.x) * k, h.a.y + (h.b.y - h.a.y) * k + arcY + 0.5, h.a.z + (h.b.z - h.a.z) * k);
      return true;
    });
  });

  return (
    <group>
      {Array.from({ length: RIPPLES }).map((_, i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
          <ringGeometry args={[0.9, 1, 48]} />
          <meshBasicMaterial transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {Array.from({ length: PACKETS }).map((_, i) => (
        <mesh key={i} ref={(el) => (packets.current[i] = el)} visible={false}>
          <sphereGeometry args={[0.55, 10, 10]} />
          <meshBasicMaterial toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Routing tree drawn as faint "silk" threads, coloured by link quality. */
export function MeshLinks({ nodes, visible }: { nodes: NodeState[]; visible: boolean }) {
  const links = useMemo(
    () =>
      nodes
        .filter((n) => n.parent && n.status !== 'tampered')
        .map((n) => {
          const a = POS.get(n.id)!;
          const b = POS.get(n.parent!)!;
          const color = n.linkPrr > 0.9 ? '#22d3ee' : n.linkPrr > 0.6 ? '#facc15' : '#f97316';
          return { key: `${n.id}-${n.parent}`, pts: [[a.x, a.y + 0.4, a.z], [b.x, b.y, b.z]] as [number, number, number][], color };
        }),
    [nodes],
  );
  if (!visible) return null;
  return (
    <group>
      {links.map((l) => (
        <Line key={l.key} points={l.pts} color={l.color} lineWidth={0.8} transparent opacity={0.35} dashed dashSize={2} gapSize={1.5} />
      ))}
    </group>
  );
}

/** Latest TDOA fix: crosshair + 1-σ uncertainty ellipse. */
export function FixMarker({ fix, simT }: { fix: Fix | undefined; simT: number }) {
  if (!fix || simT - fix.t > 25) return null;
  const color = fix.underground ? '#fb923c' : '#ef4444';
  // Surface TDOA resolves the 2-D epicentre only; depth is unresolved, so the marker sits on the
  // surface with a plumb line downwards rather than pretending to know the depth.
  const y = 0.4;
  const a = Math.max(fix.semiMajor, 1.5);
  const b = Math.max(fix.semiMinor, 1.5);
  return (
    <group position={[fix.x, y, fix.z]}>
      <mesh rotation={[-Math.PI / 2, 0, -fix.angle]} scale={[a, b, 1]}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <Line points={[[-6, 0, 0], [6, 0, 0]]} color={color} lineWidth={1.5} />
      <Line points={[[0, 0, -6], [0, 0, 6]]} color={color} lineWidth={1.5} />
      <Line points={[[0, 0, 0], [0, fix.underground ? -130 : 12, 0]]} color={color} lineWidth={1} dashed dashSize={1} gapSize={1} />
    </group>
  );
}
