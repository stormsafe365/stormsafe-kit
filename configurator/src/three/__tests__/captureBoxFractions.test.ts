import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { captureBoxFractions } from '../CaptureHook';

/** The building's box in a captured picture (CaptureHook reports it as imgs[view+'Box'] for the quote's 3D pages). */
describe('captureBoxFractions', () => {
  const cam = () => { const c = new THREE.PerspectiveCamera(38, 2, 0.5, 5000); c.position.set(0, 0, 50); c.lookAt(0, 0, 0); c.updateMatrixWorld(); c.updateProjectionMatrix(); return c; };
  const box = (w: number, h: number, cx = 0, cy = 0) => [new THREE.Vector3(cx - w / 2, cy - h / 2, 0), new THREE.Vector3(cx + w / 2, cy + h / 2, 0)];
  it('a centred box gives a centred window (y from the top)', () => {
    const [x0, y0, x1, y1] = captureBoxFractions(box(20, 10), cam()).split(',').map(Number);
    expect(x0 + x1).toBeCloseTo(1, 3);
    expect(y0 + y1).toBeCloseTo(1, 3);
    expect(x1 - x0).toBeGreaterThan(0.1);
    // a 20 x 10 box on a 2:1 picture: equal shares of width and height
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(1, 2);
  });
  it('a box above the centre sits in the upper half', () => {
    const [, y0, , y1] = captureBoxFractions(box(10, 4, 0, 8), cam()).split(',').map(Number);
    expect(y1).toBeLessThan(0.5);
    expect(y0).toBeGreaterThan(0);
  });
  it('clamps to the picture and skips points behind the camera', () => {
    expect(captureBoxFractions(box(1000, 1000), cam())).toBe('0,0,1,1');
    expect(captureBoxFractions([new THREE.Vector3(0, 0, 80)], cam())).toBe('0,0,1,1');
  });
});
