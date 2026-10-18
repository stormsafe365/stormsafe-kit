/**
 * Small name tags on the model: FRONT, BACK, LEFT SIDE, RIGHT SIDE (walkthroughs 10/16/26: the steps
 * say "Front end" / "Left side" but the model never showed which is which; owner 10/18/26: name every
 * side, make it smaller, and do not make it look like a drop-down). Page labels, not part of the 3D
 * picture sent to the rep (not drawn in the canvas). Each shows only while its wall faces the camera,
 * so a tag never floats over the building from behind.
 *
 * Sides are named as seen standing in front of the building, facing the front end. The front faces −Z
 * (cameraFit: front), so the customer's LEFT is +X and RIGHT is −X (capture.ts swaps them the same way).
 */
import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '@/store/useEditorStore';
import { useWebStore } from './store';
import { buildingCorners } from './cameraFit';

type Side = 'front' | 'back' | 'left' | 'right';
const LABEL: Record<Side, string> = { front: 'FRONT', back: 'BACK', left: 'LEFT SIDE', right: 'RIGHT SIDE' };
const SIDES: Side[] = ['front', 'back', 'left', 'right'];

export function FrontMarker() {
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const [box, setBox] = useState<THREE.Box3 | null>(null);
  const tags = useRef<Partial<Record<Side, HTMLDivElement | null>>>({});
  // the building's outline changes with its size / type / lean-tos (not with doors or colors)
  const shapeKey = useWebStore((s) => {
    const d = s.design;
    return [d.type, d.width, d.length, d.height, d.enclosedLength, ...d.leanTos.map((l) => `${l.side}:${l.width}:${l.length}:${l.start}`), d.wraps.join('')].join('|');
  });
  useEffect(() => {
    const t = setTimeout(() => {
      const pts = buildingCorners(scene);
      if (pts.length) setBox(new THREE.Box3().setFromPoints(pts));
    }, 300);
    return () => clearTimeout(t);
  }, [scene, shapeKey]);
  useFrame(() => {
    if (!box) return;
    const c = camera.position;
    const capturing = useEditorStore.getState().captureMode;
    const facing: Record<Side, boolean> = {
      front: c.z < box.min.z - 1,
      back: c.z > box.max.z + 1,
      left: c.x > box.max.x + 1,
      right: c.x < box.min.x - 1,
    };
    for (const s of SIDES) {
      const el = tags.current[s];
      if (!el) continue;
      const v = facing[s] && !capturing ? '1' : '0';
      if (el.style.opacity !== v) el.style.opacity = v;
    }
  });
  if (!box) return null;
  const midX = (box.min.x + box.max.x) / 2;
  const midZ = (box.min.z + box.max.z) / 2;
  const y = box.max.y + 0.8;
  // above the middle of each wall
  const spot: Record<Side, [number, number, number]> = {
    front: [midX, y, box.min.z],
    back: [midX, y, box.max.z],
    left: [box.max.x, y, midZ],
    right: [box.min.x, y, midZ],
  };
  return (
    <>
      {SIDES.map((s) => (
        <Html key={s} position={spot[s]} center zIndexRange={[50, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="side-tag"
            ref={(el) => {
              tags.current[s] = el;
            }}
            aria-hidden="true"
          >
            {LABEL[s]}
          </div>
        </Html>
      ))}
    </>
  );
}
