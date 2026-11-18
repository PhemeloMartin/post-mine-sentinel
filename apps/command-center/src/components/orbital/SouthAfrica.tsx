import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { PROVINCES } from '@/data/registry';
import { project } from '@/lib/geo';

const DEPTH = 0.12;

/** Holographic, extruded provinces with glowing borders. */
export function SouthAfrica() {
  const [hover, setHover] = useState<string | null>(null);

  const provinces = useMemo(
    () =>
      PROVINCES.map((p) => {
        const geoms = p.rings.map((ring) => {
          const shape = new THREE.Shape(
            ring.map(([lon, lat]) => {
              const [x, z] = project(lon, lat);
              return new THREE.Vector2(x, -z);
            }),
          );
          const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false });
          g.rotateX(-Math.PI / 2);
          return g;
        });
        const outlines = p.rings.map((ring) =>
          ring.map(([lon, lat]) => {
            const [x, z] = project(lon, lat);
            return new THREE.Vector3(x, DEPTH + 0.004, z);
          }),
        );
        // Label anchor: centroid of the largest ring.
        const largest = p.rings.reduce((a, b) => (b.length > a.length ? b : a));
        const c = largest.reduce((acc, [lon, lat]) => [acc[0] + lon / largest.length, acc[1] + lat / largest.length], [0, 0]);
        const [lx, lz] = project(c[0], c[1]);
        return { code: p.code, name: p.name, geoms, outlines, label: new THREE.Vector3(lx, DEPTH + 0.02, lz) };
      }),
    [],
  );

  return (
    <group>
      {provinces.map((p) => (
        <group key={p.code}>
          {p.geoms.map((g, i) => (
            <mesh
              key={i}
              geometry={g}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHover(p.code);
              }}
              onPointerOut={() => setHover((h) => (h === p.code ? null : h))}
            >
              <meshStandardMaterial
                color={hover === p.code ? '#0f3550' : '#0a1d30'}
                emissive={hover === p.code ? '#0b4a6b' : '#04182a'}
                emissiveIntensity={0.9}
                metalness={0.35}
                roughness={0.6}
                transparent
                opacity={0.93}
              />
            </mesh>
          ))}
          {p.outlines.map((pts, i) => (
            <Line key={i} points={pts} color={hover === p.code ? '#67e8f9' : '#1e9fc4'} lineWidth={hover === p.code ? 1.6 : 0.9} transparent opacity={0.9} />
          ))}
          <Html position={p.label} center distanceFactor={14} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap font-display text-[9px] font-bold uppercase tracking-[0.3em] text-cyan-200/40">{p.name}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}
