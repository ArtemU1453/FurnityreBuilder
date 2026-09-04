export { buildDebugView, byPaintOrder } from './debug-view.js';
export type { DebugSchemaView, DebugRect, DebugDimensionLine } from './debug-view.js';
export { DebugSchema } from './DebugSchema.js';
export type { DebugSchemaProps } from './DebugSchema.js';
export { buildCuttingView } from './cutting-view.js';
export type { CuttingMapView, CuttingSheetView, CuttingRect } from './cutting-view.js';
export { CuttingMap } from './CuttingMap.js';
export type { CuttingMapProps } from './CuttingMap.js';

/**
 * Рендерер сцены на WebGL 2 (PROMPT 23). Императивный и живущий вне
 * React: модель сцены и камеру ему отдаёт вызывающая сторона.
 */
export { createSceneRenderer, parseColor } from './gl/renderer.js';
export type { SceneRenderer, RenderRequest, RenderStyle, RenderStats, ObjectState } from './gl/renderer.js';
