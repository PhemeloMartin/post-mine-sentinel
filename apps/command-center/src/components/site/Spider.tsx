import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import type { NodeSpec } from '@/sim/layout';
import { simHolder } from '@/store/sim';

/** Visual scale: real nodes are ~4 cm across; shown ×12 so they are visible at site scale. */
const S = 1.0;

/**
 * Orb-weaver web: radial spokes + Archimedean capture spiral. In the real node the spiral is a
 * printed copper trace forming the 868 MHz antenna and the radial threads are the ground plane.
 */
function webGeometry(radius: number): THREE.Vector3[][] {
  const spokes: THREE.Vector3[][] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.13 * Math.sin(i * 7.1);
    spokes.push([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0)]);
  }
  const spiral: THREE.Vector3[] = [];
  const turns = 6;
  for (let k = 0; k <= turns * 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r = radius * (0.15 + 0.82 * (k / (turns * 60)));
    spiral.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  return [...spokes, spiral];
}

function Legs({ color }: { color: string }) {
  const legs = useMemo(() => {
    const out: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }[] = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const ang = (-0.9 + i * 0.6) * side;
        const dir = new THREE.Vector3(Math.sin(ang) * side, 0, Math.cos(ang));
        const a = new THREE.Vector3(0, 0, 0.05);
        const b = a.clone().add(dir.clone().multiplyScalar(0.35 * S)).add(new THREE.Vector3(0, 0.18 * S, 0));
        const c = b.clone().add(dir.clone().multiplyScalar(0.42 * S)).add(new THREE.Vector3(0, -0.3 * S, 0));
        out.push({ a, b, c });
      }
    }
    return out;
  }, []);
  return (
    <>
      {legs.map((l, i) => (
        <Line key={i} points={[l.a, l.b, l.c]} color={color} lineWidth={1.4} />
      ))}
    </>
  );
}

export function SpiderNode({ spec, reveal, tampered }: { spec: NodeSpec; reveal: boolean; tampered: boolean }) {
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement>(null);
  const web = useMemo(() => webGeometry(1.1 * S), []);

  useFrame(({ clock }) => {
    const sim = simHolder.current;
    const node = sim?.state.nodes.find((n) => n.id === spec.id);
    if (!node || !body.current) return;
    const t = sim!.state.t;
    const flashing = node.status === 'triggered' && t < node.flashUntil;
    const tampered = node.status === 'tampered';
    const threat = flashing && node.lastPThreat >= sim!.profile.threshold;
    const base = tampered ? '#ef4444' : threat ? '#ef4444' : flashing ? '#f59e0b' : reveal ? '#22d3ee' : '#1a1410';
    body.current.color.set(reveal || flashing || tampered ? base : '#1c1612');
    body.current.emissive.set(base);
    body.current.emissiveIntensity = reveal || flashing || tampered ? (flashing ? 2.4 + Math.sin(clock.elapsedTime * 20) : 1.2) : 0.02;
    if (ring.current) {
      ring.current.visible = reveal || threat;
      const m = ring.current.material as THREE.MeshBasicMaterial;
      m.color.set(threat ? '#ef4444' : '#22d3ee');
      m.opacity = threat ? 0.7 : 0.18;
    }
    if (label.current) {
      label.current.textContent = `${spec.id} · ${tampered ? 'TAMPERED' : node.lastClass} · ${node.battery.toFixed(0)}%`;
      label.current.style.color = tampered || threat ? '#fca5a5' : '#a5f3fc';
    }
  });

  const webColor = reveal ? '#67e8f9' : '#e2e8f0';
  const webRot: [number, number, number] = spec.web === 'v' ? [0, spec.webYaw, 0] : [-Math.PI / 2, 0, spec.webYaw];

  return (
    <group position={[spec.pos.x, spec.pos.y, spec.pos.z]}>
      {!tampered && (
        <group rotation={webRot}>
          {web.map((pts, i) => (
            <Line key={i} points={pts} color={webColor} lineWidth={reveal ? 1.2 : 0.6} transparent opacity={reveal ? 0.9 : 0.28} />
          ))}
        </group>
      )}
      <group rotation={spec.web === 'v' ? [Math.PI / 2, spec.webYaw, 0] : [0, spec.webYaw, 0]} scale={0.8}>
        <mesh position={[0, 0.12, -0.18]} scale={[1, 0.8, 1.35]}>
          <sphereGeometry args={[0.28 * S, 16, 12]} />
          <meshStandardMaterial ref={body} color="#1c1612" roughness={0.5} metalness={0.2} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.1, 0.17]}>
          <sphereGeometry args={[0.16 * S, 12, 10]} />
          <meshStandardMaterial color="#120d0a" roughness={0.6} />
        </mesh>
        <Legs color={reveal ? '#0e7490' : '#0f0b08'} />
      </group>
      {/* Detection footprint (~45 m for walking footsteps in Highveld soil) */}
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -spec.pos.y + 0.06, 0]} visible={false}>
        <ringGeometry args={[44, 45, 64]} />
        <meshBasicMaterial transparent depthWrite={false} opacity={0.06} color="#22d3ee" toneMapped={false} />
      </mesh>
      {reveal && (
        <Html position={[0, 1.9, 0]} center distanceFactor={90} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div ref={label} className="whitespace-nowrap rounded border border-cyan-400/40 bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">
            {spec.id}
          </div>
        </Html>
      )}
    </group>
  );
}
