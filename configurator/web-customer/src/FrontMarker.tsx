/**
 * A "FRONT" tag on the ground in front of the building (walkthroughs 10/16/26: the steps say "Front
 * end" / "Left side" but the model never showed which end is the front). A page label, not part of the
 * 3D picture sent to the rep (it is not drawn in the canvas). Shown only while the front faces the
 * camera, so it never floats over the building seen from behind.
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from './store';
import { buildingCorners } from './cameraFit';

export function FrontMarker() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [spot, setSpot] = useState<{ x: number; y: number; z: number } | null>(null);
  const tag = useRef<HTMLDivElement>(null);
  // the building's outline changes with its size / type / lean-tos (not with doors or colors)
  const shapeKey = useWebStore((s) => {
    const d = s.design;
    return [d.type, d.width, d.length, d.height, d.enclosedLength, ...d.leanTos.map((l) => `${l.side}:${l.width}:${l.length}:${l.start}`), d.wraps.join('')].join('|');
  });
  useEffect(() => {
    const t = setTimeout(() => {
      const pts = buildingCorners(scene);
      if (!pts.length) return;
      const b = new THREE.Box3().setFromPoints(pts);
      // above the front end (the front faces -Z, cameraFit: front): clear of the buttons along the bottom
      setSpot({ x: (b.min.x + b.max.x) / 2, y: b.max.y + 1.2, z: b.min.z });
    }, 300);
    return () => clearTimeout(t);
  }, [scene, shapeKey]);
  useFrame(() => {
    const el = tag.current;
    if (!el || !spot) return;
    const show = camera.position.z < spot.z - 1 && !useEditorStore.getState().captureMode;
    const v = show ? '1' : '0';
    if (el.style.opacity !== v) el.style.opacity = v;
  });
  if (!spot) return null;
  return (
    <Html position={[spot.x, spot.y, spot.z]} center zIndexRange={[50, 0]} style={{ pointerEvents: 'none' }}>
      <div className="front-tag" ref={tag} aria-hidden="true">
        FRONT ▼
      </div>
    </Html>
  );
}
