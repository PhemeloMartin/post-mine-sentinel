import { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { FACES, FENCE_GAPS_DEG, FENCE_RADIUS, GATEWAYS, HEADFRAME_HEIGHT, LEVELS, PATHS, ROAD, RUINS, SETTLEMENT, TAILINGS } from '@/sim/layout';
import { Rng } from '@/sim/rng';

const RUST = '#5b3a29';
const STEEL = '#3f4650';

/** Deterministic value noise for the veld surface. */
function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const flatten = Math.min(1, Math.max(0, (r - 18) / 40));
  const n = Math.sin(x * 0.031) * Math.cos(z * 0.027) * 1.4 + Math.sin((x + z) * 0.013) * 1.8 + Math.sin(x * 0.11 + z * 0.07) * 0.25;
  return n * flatten;
}

export function Terrain({ xray, night }: { xray: boolean; night: boolean }) {
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(620, 620, 160, 160);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - 0.05);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geom} receiveShadow renderOrder={xray ? 2 : 0}>
      <meshStandardMaterial
        color={night ? '#4a4634' : '#7a6a42'}
        roughness={0.95}
        flatShading
        transparent
        opacity={xray ? 0.18 : 1}
        depthWrite={!xray}
      />
    </mesh>
  );
}

export function Headframe() {
  const members = useMemo(() => {
    const legs: [THREE.Vector3, THREE.Vector3][] = [];
    const h = HEADFRAME_HEIGHT;
    const base = 5;
    const top = 2.2;
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ];
    corners.forEach(([sx, sz]) => legs.push([new THREE.Vector3(sx * base, 0, sz * base), new THREE.Vector3(sx * top, h, sz * top)]));
    // Horizontal rings and X-bracing between legs at each bay.
    const bays = 6;
    for (let b = 0; b <= bays; b++) {
      const y = (h * b) / bays;
      const w = base + (top - base) * (b / bays);
      for (let i = 0; i < 4; i++) {
        const [ax, az] = corners[i];
        const [bx, bz] = corners[(i + 1) % 4];
        legs.push([new THREE.Vector3(ax * w, y, az * w), new THREE.Vector3(bx * w, y, bz * w)]);
        if (b < bays) {
          const y2 = (h * (b + 1)) / bays;
          const w2 = base + (top - base) * ((b + 1) / bays);
          legs.push([new THREE.Vector3(ax * w, y, az * w), new THREE.Vector3(bx * w2, y2, bz * w2)]);
        }
      }
    }
    return legs;
  }, []);
  return (
    <group>
      {members.map(([a, b], i) => {
        const len = a.distanceTo(b);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        return (
          <mesh key={i} position={mid} quaternion={q} castShadow>
            <cylinderGeometry args={[i < 4 ? 0.28 : 0.12, i < 4 ? 0.28 : 0.12, len, 6]} />
            <meshStandardMaterial color={i < 4 ? RUST : STEEL} roughness={0.8} metalness={0.5} />
          </mesh>
        );
      })}
      {/* Sheave wheels */}
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} position={[x, HEADFRAME_HEIGHT + 0.6, 0]} rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[1.6, 0.14, 8, 28]} />
          <meshStandardMaterial color={RUST} metalness={0.6} roughness={0.6} />
        </mesh>
      ))}
      {/* Collar slab with the open shaft */}
      <mesh position={[0, 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 7, 40]} />
        <meshStandardMaterial color="#4b4b46" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.2, 40]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
    </group>
  );
}

export function Ruins() {
  return (
    <group>
      {RUINS.map((r) => (
        <group key={r.id} position={[r.pos.x, 0, r.pos.z]}>
          {/* Four broken walls, no roof */}
          {[
            [0, r.size.z / 2, r.size.x, 0.5, 1],
            [0, -r.size.z / 2, r.size.x * 0.6, 0.5, 0.7],
            [r.size.x / 2, 0, 0.5, r.size.z, 0.85],
            [-r.size.x / 2, 0, 0.5, r.size.z, 0.55],
          ].map(([x, z, w, d, hk], i) => (
            <mesh key={i} position={[x, (r.size.y * hk) / 2, z]} castShadow receiveShadow>
              <boxGeometry args={[w, r.size.y * hk, d]} />
              <meshStandardMaterial color="#5c4a3d" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export function Fence() {
  const posts = useMemo(() => {
    const out: THREE.Vector3[] = [];
    for (let deg = 0; deg < 360; deg += 7.5) {
      if (FENCE_GAPS_DEG.some((g) => Math.abs(((deg - g + 540) % 360) - 180) < 8)) continue;
      const a = (deg * Math.PI) / 180;
      out.push(new THREE.Vector3(FENCE_RADIUS * Math.cos(a), 0, FENCE_RADIUS * Math.sin(a)));
    }
    return out;
  }, []);
  return (
    <group>
      {posts.map((p, i) => (
        <mesh key={i} position={[p.x, 0.75, p.z]} rotation={[0.04 * Math.sin(i), 0, 0.06 * Math.cos(i * 1.7)]}>
          <cylinderGeometry args={[0.06, 0.08, 1.5, 5]} />
          <meshStandardMaterial color="#6b5a43" roughness={1} />
        </mesh>
      ))}
      {[0.6, 1.1, 1.4].map((h) => (
        <Line key={h} points={[...posts.map((p) => [p.x, h, p.z] as [number, number, number])]} color="#8a8f96" lineWidth={0.5} transparent opacity={0.5} />
      ))}
    </group>
  );
}

export function Landscape() {
  const { rocks, bushes, shacks } = useMemo(() => {
    const rng = new Rng(42);
    const rocks = Array.from({ length: 70 }, () => ({
      x: rng.uniform(-230, 230),
      z: rng.uniform(-230, 230),
      s: rng.uniform(0.6, 2.6),
      r: rng.uniform(0, Math.PI),
    })).filter((r) => Math.hypot(r.x, r.z) > 14);
    const bushes = Array.from({ length: 160 }, () => ({ x: rng.uniform(-260, 260), z: rng.uniform(-260, 260), s: rng.uniform(0.8, 2.2) })).filter(
      (b) => Math.hypot(b.x, b.z) > 12,
    );
    const shacks = Array.from({ length: 14 }, (_, i) => ({
      x: SETTLEMENT.x + rng.uniform(-30, 30),
      z: SETTLEMENT.z + rng.uniform(-24, 24),
      w: rng.uniform(3, 5),
      d: rng.uniform(3, 4.5),
      rot: rng.uniform(0, Math.PI),
      lit: i % 3 === 0,
    }));
    return { rocks, bushes, shacks };
  }, []);
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, r.s * 0.3, r.z]} rotation={[r.r, r.r * 2, 0]} scale={r.s} castShadow>
          <dodecahedronGeometry args={[0.7, 0]} />
          <meshStandardMaterial color="#6d6862" roughness={1} flatShading />
        </mesh>
      ))}
      {bushes.map((b, i) => (
        <mesh key={i} position={[b.x, b.s * 0.4, b.z]} scale={[b.s, b.s * 0.7, b.s]}>
          <icosahedronGeometry args={[0.8, 0]} />
          <meshStandardMaterial color="#3f4a2a" roughness={1} flatShading />
        </mesh>
      ))}
      {/* Tailings dump (yellow-grey slimes) */}
      <mesh position={[TAILINGS.pos.x, TAILINGS.height / 2, TAILINGS.pos.z]}>
        <cylinderGeometry args={[TAILINGS.radius * 0.7, TAILINGS.radius, TAILINGS.height, 32]} />
        <meshStandardMaterial color="#b9a46a" roughness={1} flatShading />
      </mesh>
      {/* Informal settlement */}
      {shacks.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.rot, 0]}>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[s.w, 2.4, s.d]} />
            <meshStandardMaterial color={i % 2 ? '#7c8187' : '#8b6f4e'} metalness={0.4} roughness={0.6} />
          </mesh>
          {s.lit && (
            <mesh position={[s.w / 2 + 0.01, 1.3, 0]}>
              <planeGeometry args={[0.6, 0.5]} />
              <meshBasicMaterial color="#fcd34d" toneMapped={false} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
      {/* Footpaths and access road */}
      {Object.values(PATHS).map((p, i) => (
        <Line key={i} points={p.map((v) => [v.x, 0.08, v.z] as [number, number, number])} color="#8d7b5a" lineWidth={2} transparent opacity={0.55} />
      ))}
      <Line points={ROAD.map((v) => [v.x, 0.09, v.z] as [number, number, number])} color="#55524c" lineWidth={6} />
    </group>
  );
}

export function Underground({ visible }: { visible: boolean }) {
  const depth = Math.abs(LEVELS[LEVELS.length - 1]) + 12;
  return (
    <group visible={visible}>
      <mesh position={[0, -depth / 2, 0]}>
        <cylinderGeometry args={[3.2, 3.2, depth, 24, 1, true]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0c4a6e" emissiveIntensity={0.6} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {LEVELS.map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.3, 7, 24]} />
          <meshBasicMaterial color="#0ea5e9" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
      {FACES.map((f, i) => (
        <group key={i}>
          <Line points={f.route.map((v) => [v.x, v.y, v.z] as [number, number, number])} color="#38bdf8" lineWidth={6} transparent opacity={0.35} />
          {/* Stope: the inclined reef slab mined out above the drift */}
          <mesh position={[f.route[2].x * 0.6, f.route[2].y + 9, f.route[2].z * 0.6]} rotation={[0.35, Math.atan2(f.route[2].x, f.route[2].z), 0]}>
            <boxGeometry args={[18, 0.9, 30]} />
            <meshBasicMaterial color="#f59e0b" transparent opacity={0.12} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Gateways({ reveal }: { reveal: boolean }) {
  return (
    <group>
      {GATEWAYS.map((g) => (
        <group key={g.id} position={[g.pos.x, g.pos.y, g.pos.z]}>
          {g.id === 'A2' && (
            <mesh position={[0, -g.pos.y / 2, 0]}>
              <cylinderGeometry args={[0.15, 0.2, g.pos.y, 8]} />
              <meshStandardMaterial color="#4a3b2c" roughness={1} />
            </mesh>
          )}
          <mesh>
            <boxGeometry args={g.id === 'A1' ? [1.6, 1.0, 1.0] : [0.8, 0.9, 0.7]} />
            <meshStandardMaterial
              color={g.id === 'A1' ? RUST : '#6b4f33'}
              emissive={reveal ? '#22d3ee' : '#000000'}
              emissiveIntensity={reveal ? 1.6 : 0}
              toneMapped={!reveal}
            />
          </mesh>
          {g.id === 'A2' && (
            <mesh position={[0, 0.65, 0]} rotation={[-0.5, 0, 0]}>
              <boxGeometry args={[0.9, 0.04, 0.6]} />
              <meshStandardMaterial color="#1e3a8a" metalness={0.8} roughness={0.2} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
