import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { HUB_BY_ID } from '@/data/registry';
import { project } from '@/lib/geo';
import { prefersReducedMotion } from '@/lib/webgl';
import { useOrbital } from '@/store/orbital';
import { MineField } from './MineField';
import { NetworkLayer } from './NetworkLayer';
import { RadarSweep } from './RadarSweep';
import { SouthAfrica } from './SouthAfrica';
import type { VisibleMine } from './visibility';

function CameraRig({ items }: { items: VisibleMine[] }) {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const { camera } = useThree();
  const selectedId = useOrbital((s) => s.selectedId);
  const flight = useRef<{ target: THREE.Vector3; pos: THREE.Vector3; until: number } | null>(null);

  useEffect(() => {
    const sel = items.find((i) => i.mine.id === selectedId);
    if (!sel) {
      flight.current = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(0, 13, 15), until: performance.now() + 1600 };
      return;
    }
    const target = new THREE.Vector3(sel.x, 0.3, sel.z);
    flight.current = { target, pos: target.clone().add(new THREE.Vector3(1.8, 3.2, 3.6)), until: performance.now() + 1600 };
    // Only re-fly when the selection changes, not on every timeline tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useFrame(() => {
    const f = flight.current;
    if (!f || !controls) return;
    if (performance.now() > f.until) {
      flight.current = null;
      return;
    }
    controls.target.lerp(f.target, 0.07);
    camera.position.lerp(f.pos, 0.05);
    controls.update();
  });
  return null;
}

export function OrbitalScene({ items, restricted, showNetwork }: { items: VisibleMine[]; restricted: boolean; showNetwork: boolean }) {
  const autoRotate = useOrbital((s) => s.autoRotate);
  const selectedId = useOrbital((s) => s.selectedId);
  const select = useOrbital((s) => s.select);
  const reduced = prefersReducedMotion();
  const nat = HUB_BY_ID.get('SOC-NAT')!;
  const [nx, nz] = project(nat.lon, nat.lat);

  return (
    <Canvas
      camera={{ position: [0, 13, 15], fov: 42, near: 0.1, far: 400 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onPointerMissed={() => select(null)}
      aria-label="3D map of South African mines"
    >
      <color attach="background" args={['#02050b']} />
      <fog attach="fog" args={['#02050b', 26, 70]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[6, 14, 4]} intensity={0.9} color="#bae6fd" />
      <pointLight position={[0, 6, 0]} intensity={30} distance={30} color="#22d3ee" />
      <Stars radius={140} depth={70} count={5000} factor={3.5} saturation={0} fade speed={reduced ? 0 : 0.5} />
      <Grid
        position={[0, -0.02, 0]}
        args={[80, 80]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#0b2536"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#0f3d58"
        fadeDistance={45}
        fadeStrength={1.5}
        infiniteGrid
      />
      <SouthAfrica />
      <MineField items={items} restricted={restricted} />
      {showNetwork && !restricted && <NetworkLayer />}
      <RadarSweep position={[nx, 0.135, nz]} radius={8} />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        autoRotate={autoRotate && !reduced && !selectedId}
        autoRotateSpeed={0.35}
        minDistance={3}
        maxDistance={42}
        maxPolarAngle={1.38}
      />
      <CameraRig items={items} />
      <EffectComposer multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.2} luminanceSmoothing={0.3} intensity={1.15} />
        <Vignette eskil={false} offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
