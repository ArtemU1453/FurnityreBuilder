/**
 * Планировщик помещения: публичная поверхность (PROMPT 24 §2).
 *
 * Слой чистый — ни React, ни WebGL, ни DOM, ни команд. Он отвечает за
 * помещение и РАЗМЕЩЕНИЕ объектов; внутреннюю конструкцию мебели
 * по-прежнему считает `buildGeometry`, и планировщик её не трогает.
 */
export type { Footprint, RoomBox } from './placement.js';
export {
  furnitureExtent,
  footprintOf,
  instanceFootprint,
  instanceBox,
  obstacleBox,
  wallBox,
  roomFootprint,
  isRectangular,
  footprintsOverlap,
  footprintGap,
  boxesOverlap,
  normalizeRotation,
  snapRotationToQuarter,
  swapsAxes,
} from './placement.js';

export type { SnapCandidate, SnapKind, SnapResult } from './snap.js';
export type { Placement } from './autoplace.js';
export { findPlacement } from './autoplace.js';
export { snapCandidates, applySnap } from './snap.js';

export type { ClearanceRule, CollisionOptions, CollisionPair, CollisionResult, ExtentLookup } from './collision.js';
export { detectCollisions, COLLISION_CODES, DEFAULT_CLEARANCE_RULES, PROXIMITY_MM } from './collision.js';

export type { RoomStatus, RoomValidationOptions, RoomValidationResult } from './validation.js';
export { validateRoom, statusOf, roomSize, ROOM_CODES, NO_EXTENTS } from './validation.js';
