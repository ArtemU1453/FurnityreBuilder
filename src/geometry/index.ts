export * from './types.js';
export { computeBoundingBox, EMPTY_BOUNDING_BOX } from './bounding-box.js';
export type { BoundingBox } from './bounding-box.js';
export { GeometryContext } from './context.js';
export type { GeometryStage } from './context.js';
export { buildGeometry, PIPELINE } from './engine.js';
export { makePart, rawCutSize, applyEdgeSizing, edgeKey, resolveMaterial } from './parts.js';
export { resolveBackGeometry } from './stages/carcass.js';
