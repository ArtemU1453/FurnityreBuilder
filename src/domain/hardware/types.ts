import type { HardwareId, PartId } from '../ids.js';

export type HardwareKind =
  | 'confirmat'
  | 'eccentric'
  | 'dowel'
  | 'shelf-support'
  | 'hinge'
  | 'slide'
  | 'handle'
  | 'push-latch'
  | 'rod'
  | 'rod-flange'
  | 'leg'
  | 'plinth-clip'
  | 'back-nail';

export interface HardwareItem {
  readonly id: HardwareId;
  readonly kind: HardwareKind;
  readonly name: string;
  /** Свободные характеристики: «7×50», «угол 110°», «длина 450». */
  readonly spec: Readonly<Record<string, string | number>>;
}

export interface HardwareLibrary {
  readonly items: Readonly<Record<string, HardwareItem>>;
}

/**
 * Строка итоговой спецификации.
 * `sourcePartIds` даёт трассируемость: по любой позиции видно, какие детали
 * её породили, и её можно подсветить на схеме.
 */
export interface HardwareLine {
  readonly hardwareId: HardwareId;
  readonly quantity: number;
  readonly sourcePartIds: readonly PartId[];
}

export const EMPTY_HARDWARE_LIBRARY: HardwareLibrary = { items: {} };
