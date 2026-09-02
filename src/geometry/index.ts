export * from './types.js';
export { GeometryContext } from './context.js';
export type { GeometryStage } from './context.js';
export { buildGeometry, PIPELINE } from './engine.js';
export { makePart, rawCutSize, applyEdgeSizing, edgeKey, resolveMaterial } from './parts.js';
export { resolveBackGeometry } from './stages/carcass.js';
