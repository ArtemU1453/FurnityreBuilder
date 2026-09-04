/**
 * Модель сцены: публичная поверхность (PROMPT 23 §3).
 *
 * Слой чистый — ни React, ни WebGL, ни DOM. Проверяется линтером
 * (`PURE_LAYERS` в eslint.config.js) и тем, что все его тесты идут в
 * окружении `node`.
 */
export type {
  SceneObject,
  SceneObjectKind,
  SceneModel,
  SceneMaterial,
  GizmoAxis,
  GizmoTarget,
} from './types.js';
export { EMPTY_SCENE, FALLBACK_MATERIAL, TRANSPARENT_KINDS, partIdOf, nodeIdOf } from './types.js';

export { buildScene, findSceneObject, cellsOfSection } from './adapter.js';
export { buildRoomScene, instanceIdOf, ROOM_PREFIX } from './room-scene.js';
export type { RoomSceneOptions } from './room-scene.js';
export { toSceneMaterial, sceneMaterialOf, buildSceneMaterials } from './materials.js';

export type { Mat4 } from './math.js';
export {
  identity,
  multiply,
  composeBox,
  perspective,
  orthographic,
  lookAt,
  invert,
  transformPoint,
  normalize,
  cross,
  dot,
  add,
  sub,
  scale,
  length,
} from './math.js';

export type { Camera, ProjectionKind, ViewPreset, Ray } from './camera.js';
export {
  cameraForPreset,
  eyeOf,
  viewMatrix,
  projectionMatrix,
  viewProjection,
  orbit,
  pan,
  zoom,
  rayFromNdc,
  pixelsPerMmAlong,
  screenDirectionOf,
  fitDistance,
  clampElevation,
  DEFAULT_FOV_Y,
  MIN_DISTANCE_FACTOR,
  MAX_DISTANCE_FACTOR,
} from './camera.js';

export type { Hit, PickOptions } from './raycast.js';
export { intersectBox, pick, pickAll } from './raycast.js';

export {
  buildGizmos,
  withGizmos,
  gizmoBaseValue,
  gripFor,
  COARSE_GRIP_SCALE,
  MIN_GIZMO_GRIP,
  MAX_GIZMO_GRIP,
} from './gizmos.js';
