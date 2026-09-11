/** Типы разбора ящиков (FR-04). Вне продуктового слоя. */
export interface DrawerPart {
  readonly L: number;
  readonly W: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly bay: number | null;
}
export interface DrawerRecord {
  readonly index: number;
  readonly bay: number | null;
  readonly anchorY: number;
  readonly partCount: number;
  readonly facade: DrawerPart | null;
  readonly back: DrawerPart | null;
  readonly left: DrawerPart | null;
  readonly right: DrawerPart | null;
  readonly bottom: DrawerPart | null;
  readonly slide: { x: number; y: number; z: number } | null;
  readonly handle: { x: number; y: number; z: number } | null;
}
export function drawersOf(path: string): readonly DrawerRecord[];
