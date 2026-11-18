import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { simHolder } from '@/store/sim';

const PEOPLE = 16;
const ANIMALS = 10;
const VEHICLES = 3;

/**
 * Agents are drawn from fixed-size object pools updated in useFrame, so movement is smooth at
 * any simulation speed without re-rendering React. People are abstract figures with headlamps:
 * the system observes vibration and warmth, never identity.
 */
export function Agents({ night }: { night: boolean }) {
  const people = useRef<(THREE.Group | null)[]>([]);
  const animals = useRef<(THREE.Group | null)[]>([]);
  const vehicles = useRef<(THREE.Group | null)[]>([]);
  const beacons = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const sim = simHolder.current;
    const agents = sim?.state.agents ?? [];
    let p = 0;
    let a = 0;
    let v = 0;
    for (const ag of agents) {
      if (ag.kind === 'intruder' || ag.kind === 'crew') {
        const g = people.current[p++];
        if (!g) continue;
        g.visible = true;
        g.position.set(ag.pos.x, ag.pos.y, ag.pos.z);
        g.rotation.y = ag.heading;
        const bob = ag.mode === 'work' ? Math.sin(clock.elapsedTime * 9 + p) * 0.25 : Math.sin(clock.elapsedTime * 12 + p) * 0.05;
        g.children[0].rotation.x = ag.mode === 'work' ? 0.5 + bob : 0;
      } else if (ag.kind === 'jackal' || ag.kind === 'cattle') {
        const g = animals.current[a++];
        if (!g) continue;
        g.visible = true;
        g.position.set(ag.pos.x, 0, ag.pos.z);
        g.rotation.y = ag.heading;
        const s = ag.kind === 'cattle' ? 1 : 0.42;
        g.scale.setScalar(s);
      } else {
        const g = vehicles.current[v];
        const b = beacons.current[v];
        v++;
        if (!g) continue;
        g.visible = true;
        g.position.set(ag.pos.x, 0, ag.pos.z);
        g.rotation.y = ag.heading;
        if (b) {
          b.visible = ag.kind === 'responder';
          (b.material as THREE.MeshBasicMaterial).color.set(Math.sin(clock.elapsedTime * 10) > 0 ? '#3b82f6' : '#ef4444');
        }
      }
    }
    for (let i = p; i < PEOPLE; i++) if (people.current[i]) people.current[i]!.visible = false;
    for (let i = a; i < ANIMALS; i++) if (animals.current[i]) animals.current[i]!.visible = false;
    for (let i = v; i < VEHICLES; i++) if (vehicles.current[i]) vehicles.current[i]!.visible = false;
  });

  return (
    <group>
      {Array.from({ length: PEOPLE }).map((_, i) => (
        <group key={`p${i}`} ref={(el) => (people.current[i] = el)} visible={false}>
          <group>
            <mesh position={[0, 0.95, 0]}>
              <capsuleGeometry args={[0.28, 0.9, 4, 8]} />
              <meshStandardMaterial color="#3a3f47" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.78, 0]}>
              <sphereGeometry args={[0.2, 10, 10]} />
              <meshStandardMaterial color="#2b2b2b" />
            </mesh>
            {/* Headlamp */}
            <mesh position={[0, 1.84, 0.2]}>
              <sphereGeometry args={[0.09, 8, 8]} />
              <meshBasicMaterial color={night ? '#fef9c3' : '#94a3b8'} toneMapped={false} />
            </mesh>
          </group>
        </group>
      ))}
      {Array.from({ length: ANIMALS }).map((_, i) => (
        <group key={`a${i}`} ref={(el) => (animals.current[i] = el)} visible={false}>
          <mesh position={[0, 1.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.45, 1.4, 4, 8]} />
            <meshStandardMaterial color="#5b4636" roughness={1} />
          </mesh>
          <mesh position={[0, 1.35, 1.05]}>
            <boxGeometry args={[0.4, 0.45, 0.6]} />
            <meshStandardMaterial color="#4a3a2c" />
          </mesh>
          {[-0.3, 0.3].map((x) =>
            [-0.55, 0.55].map((z) => (
              <mesh key={`${x}${z}`} position={[x, 0.35, z]}>
                <cylinderGeometry args={[0.08, 0.08, 0.7, 5]} />
                <meshStandardMaterial color="#3d2f24" />
              </mesh>
            )),
          )}
        </group>
      ))}
      {Array.from({ length: VEHICLES }).map((_, i) => (
        <group key={`v${i}`} ref={(el) => (vehicles.current[i] = el)} visible={false}>
          <mesh position={[0, 0.9, 0]}>
            <boxGeometry args={[2, 1, 4.6]} />
            <meshStandardMaterial color="#d6d3d1" metalness={0.4} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.65, 0.6]}>
            <boxGeometry args={[1.8, 0.7, 1.8]} />
            <meshStandardMaterial color="#1e293b" metalness={0.6} />
          </mesh>
          {[-0.9, 0.9].map((x) => (
            <mesh key={x} position={[x * 0.6, 0.9, 2.31]}>
              <planeGeometry args={[0.35, 0.2]} />
              <meshBasicMaterial color="#fffbeb" toneMapped={false} />
            </mesh>
          ))}
          <mesh ref={(el) => (beacons.current[i] = el)} position={[0, 2.1, 0.6]} visible={false}>
            <boxGeometry args={[1.2, 0.18, 0.3]} />
            <meshBasicMaterial color="#3b82f6" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
