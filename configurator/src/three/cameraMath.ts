/**
 * Camera framing math shared by the named views (CameraRig: front / back /
 * left / right / top / iso / structure) and the walk-in Interior arrival on a
 * cross wall (interiorView: the End Storage partition / GCH divider), so a
 * wall is framed the same way inside as outside. Pure (no three.js).
 */

/** Margin every named view frames a face with: the face fills the frame with ~18% to spare. */
export const FIT_MARGIN = 1.18;

/**
 * Distance from the centre of a face (spanW wide x spanH tall, square to the
 * view) at which it fits a perspective camera with vertical FOV `fovDeg` and
 * `aspect` = width / height, times `margin`. Whichever of width / height binds
 * wins, so a wide face fits sideways and a tall one top to bottom.
 */
export function fitDistance(spanW: number, spanH: number, fovDeg: number, aspect: number, margin: number = FIT_MARGIN): number {
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  return Math.max(spanH / 2 / Math.tan(vHalf), spanW / 2 / Math.tan(hHalf)) * margin;
}
