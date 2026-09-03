export * from './types.js';
export {
  createDefaultHardwareLibrary,
  DEFAULT_HARDWARE_LIBRARY,
  HW_HINGE,
  HW_HINGE_FASTENER,
  HW_SLIDE,
  HW_SHELF_SUPPORT,
  HW_BACK_FASTENER,
  HW_CARCASS_FASTENER,
  HW_HANDLE,
  HW_HANDLE_FASTENER,
  HW_PUSH_LATCH,
} from './registry.js';
export { calculateHardware, mergeHardwareBoms, HARDWARE_RULES } from './engine.js';
export { formatHardwareDebug, formatHardwareItem } from './debug.js';
export type { CalculateHardwareOptions } from './engine.js';
export { hingeRule, hingeFastenerRule, hingeCountForHeight, HINGE_COUNT_TABLE } from './rules/hinges.js';
export type { HingeCountThreshold } from './rules/hinges.js';
export { slideRule, slidesPerDrawer } from './rules/slides.js';
export { shelfSupportRule, supportsPerShelf } from './rules/shelf-supports.js';
export {
  backWallFastenerRule,
  carcassFastenerRule,
  findCarcassJoints,
  BACK_WALL_FASTENER_SPACING,
  CARCASS_FASTENERS_PER_JOINT,
} from './rules/fasteners.js';
export type { BackWallFastenerSpacing, CarcassJoint } from './rules/fasteners.js';
export { handleRule, handleFastenerRule, pushToOpenRule } from './rules/opening.js';
