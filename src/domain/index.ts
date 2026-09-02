/**
 * Публичная поверхность доменного слоя.
 *
 * Домен не зависит ни от React, ни от DOM, ни от браузерных API. Это не
 * пожелание, а правило, проверяемое линтером: см. eslint.config.js и
 * docs/ARCHITECTURE.md §1.
 */
export * from './units.js';
export * from './ids.js';
export * from './coordinates.js';
export * from './diagnostics.js';

export * from './materials/types.js';
export * from './materials/defaults.js';

export * from './hardware/types.js';

export * from './part/types.js';
export * from './part/id.js';

export * from './furniture/types.js';
export * from './furniture/defaults.js';
export * from './furniture/tree.js';
export * from './furniture/sections.js';
export * from './furniture/layout.js';

export * from './project/types.js';
export * from './project/factory.js';
