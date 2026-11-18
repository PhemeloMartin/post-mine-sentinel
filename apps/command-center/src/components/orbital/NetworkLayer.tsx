import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { HUB_BY_ID, MINE_BY_ID, NETWORK } from '@/data/registry';
import { project } from '@/lib/geo';

const MEDIUM_COLOR: Record<string, string> = {
  fibre: '#22d3ee',
  microwave: '#a78bfa',
  leo_satellite: '#f472b6',
  lte: '#38bdf8',
};

function arc(a: THREE.Vector3, b: THREE.Vector3, lift: number): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y += lift + a.distanceTo(b) * 0.22;
  return new THREE.QuadraticBezierCurve3(a, mid, b);
}

/** Sentinel's own national network: SOC hubs, backbone links and pilot deployments. */
export function NetworkLayer() {
  const { hubs, backbone, deployments } = useMemo(() => {
    const hubPos = new Map(
      NETWORK.hubs.map((h) => {
        const [x, z] = project(h.lon, h.lat);
        return [h.id, new THREE.Vector3(x, 0.55, z)];
      }),
    );
    const bb = NETWORK.backbone.map((l) => ({
      curve: arc(hubPos.get(l.from)!, hubPos.get(l.to)!, 0.3),
      color: MEDIUM_COLOR[l.medium] ?? '#22d3ee',
      key: `${l.from}-${l.to}`,
    }));
    const dep = NETWORK.deployments
      .map((d) => {
        const m = MINE_BY_ID.get(d.mineId);
        if (!m) return null;
        const [x, z] = project(m.lon, m.lat);
        return { curve: arc(new THREE.Vector3(x, 0.15, z), hubPos.get(d.hub)!, 0.05), color: MEDIUM_COLOR[d.backhaul], key: d.mineId };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    return { hubs: [...hubPos.entries()], backbone: bb, deployments: dep };
  }, []);

  return (
    <group>
      {hubs.map(([id, pos]) => (
        <Hub key={id} id={id} pos={pos} />
      ))}
      {backbone.map((l) => (
        <Link key={l.key} curve={l.curve} color={l.color} width={1.4} packets={3} speed={0.18} />
      ))}
      {deployments.map((l) => (
        <Link key={l.key} curve={l.curve} color={l.color} width={0.8} packets={1} speed={0.35} />
      ))}
    </group>
  );
}

function Hub({ id, pos }: { id: string; pos: THREE.Vector3 }) {
  const ref = useRef<THREE.Mesh>(null);
  const hub = HUB_BY_ID.get(id)!;
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.8;
  });
  const size = hub.tier === 0 ? 0.16 : 0.1;
  return (
    <group position={pos}>
      <mesh ref={ref}>
        <octahedronGeometry args={[size, 0]} />
        <meshBasicMaterial color={hub.tier === 0 ? '#f0abfc' : '#a5f3fc'} toneMapped={false} wireframe />
      </mesh>
      <mesh>
        <sphereGeometry args={[size * 0.45, 12, 12]} />
        <meshBasicMaterial color={hub.tier === 0 ? '#e879f9' : '#22d3ee'} toneMapped={false} />
      </mesh>
      <Line points={[[0, 0, 0], [0, -0.43, 0]]} color="#22d3ee" lineWidth={0.6} transparent opacity={0.5} />
      <Html position={[0, size + 0.12, 0]} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
        <div className="whitespace-nowrap rounded border border-cyan-400/30 bg-slate-950/70 px-1.5 py-0.5 font-mono text-[9px] text-cyan-200">{id}</div>
      </Html>
    </group>
  );
}

function Link({ curve, color, width, packets, speed }: { curve: THREE.QuadraticBezierCurve3; color: string; width: number; packets: number; speed: number }) {
  const pts = useMemo(() => curve.getPoints(40), [curve]);
  const dots = useRef<(THREE.Mesh | null)[]>([]);
  const offset = useMemo(() => Math.random(), []);
  useFrame(({ clock }) => {
    dots.current.forEach((d, i) => {
      if (!d) return;
      const t = (clock.elapsedTime * speed + offset + i / packets) % 1;
      d.position.copy(curve.getPoint(t));
    });
  });
  return (
    <group>
      <Line points={pts} color={color} lineWidth={width} transparent opacity={0.45} />
      {Array.from({ length: packets }).map((_, i) => (
        <mesh key={i} ref={(el) => (dots.current[i] = el)}>
          <sphereGeometry args={[0.035, 8, 8]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
