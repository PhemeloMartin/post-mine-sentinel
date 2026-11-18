import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BAND_COLOR, COMMODITY_LABEL, STATUS_COLOR, STATUS_GLYPH, STATUS_LABEL } from '@/lib/theme';
import { useOrbital } from '@/store/orbital';
import type { VisibleMine } from './visibility';

const BASE_Y = 0.125;
const MAX = 256;
const tmp = new THREE.Object3D();
const color = new THREE.Color();

/** All mines as one instanced draw call: light pillars coloured by status at the timeline year. */
export function MineField({ items, restricted }: { items: VisibleMine[]; restricted: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const caps = useRef<THREE.InstancedMesh>(null);
  const { hoveredId, selectedId, hover, select } = useOrbital();

  const geom = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.035, 0.05, 1, 10, 1, true);
    g.translate(0, 0.5, 0);
    return g;
  }, []);

  useEffect(() => {
    const mesh = ref.current;
    const capMesh = caps.current;
    if (!mesh || !capMesh) return;
    items.forEach((it, i) => {
      const emphasis = it.mine.id === selectedId || it.mine.id === hoveredId ? 1.35 : 1;
      tmp.position.set(it.x, BASE_Y, it.z);
      tmp.scale.set(emphasis, it.height, emphasis);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
      mesh.setColorAt(i, color.set(STATUS_COLOR[it.status]).multiplyScalar(1.6));
      tmp.position.set(it.x, BASE_Y + it.height, it.z);
      tmp.scale.setScalar(emphasis);
      tmp.updateMatrix();
      capMesh.setMatrixAt(i, tmp.matrix);
      capMesh.setColorAt(i, color.set(STATUS_COLOR[it.status]).multiplyScalar(2.4));
    });
    mesh.count = items.length;
    capMesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    capMesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
  }, [items, hoveredId, selectedId]);

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) hover(items[e.instanceId]?.mine.id ?? null);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId !== undefined) select(items[e.instanceId]?.mine.id ?? null);
  };

  const hovered = items.find((i) => i.mine.id === hoveredId);

  return (
    <group>
      <instancedMesh ref={ref} args={[geom, undefined, MAX]} onPointerMove={onMove} onPointerOut={() => hover(null)} onClick={onClick}>
        <meshBasicMaterial toneMapped={false} transparent opacity={0.85} side={THREE.DoubleSide} />
      </instancedMesh>
      <instancedMesh ref={caps} args={[undefined, undefined, MAX]} onPointerMove={onMove} onClick={onClick}>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <RiskHalos items={items} />
      {hovered && (
        <Html position={[hovered.x, BASE_Y + hovered.height + 0.25, hovered.z]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="hud-panel min-w-44 whitespace-nowrap px-3 py-2 text-[11px]">
            <div className="font-semibold text-slate-100">{hovered.mine.name}</div>
            <div className="mt-0.5 flex items-center gap-2 text-slate-400">
              <span style={{ color: STATUS_COLOR[hovered.status] }}>
                {STATUS_GLYPH[hovered.status]} {STATUS_LABEL[hovered.status]}
              </span>
              <span>· {COMMODITY_LABEL[hovered.mine.commodity]}</span>
            </div>
            {!restricted && (
              <div className="mt-0.5 font-mono" style={{ color: BAND_COLOR[hovered.mine.risk.band] }}>
                RAI {hovered.mine.risk.rai.toFixed(1)} · {hovered.mine.risk.band}
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

/** Pulsing rings around dormant high-risk sites: where illegal mining is most likely right now. */
function RiskHalos({ items }: { items: VisibleMine[] }) {
  const hot = items.filter((i) => i.mine.risk.rai >= 50 && i.status !== 'operating' && i.status !== 'rehabilitated');
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const k = (clock.elapsedTime * 0.6 + i * 0.137) % 1;
      child.scale.setScalar(0.4 + k * 1.6);
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      mat.opacity = 0.75 * (1 - k);
    });
  });
  return (
    <group ref={group}>
      {hot.map((h) => (
        <mesh key={h.mine.id} position={[h.x, BASE_Y + 0.01, h.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.16, 0.2, 40]} />
          <meshBasicMaterial color={BAND_COLOR[h.mine.risk.band]} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
