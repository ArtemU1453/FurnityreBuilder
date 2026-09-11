/** Типы сборщика объектов .b3d (PROMPT 66 §3). Вне продуктового слоя. */
export interface B3dObject {
  readonly type: number;
  readonly name: string;
  readonly id: number | null;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rot: { x: number; y: number; z: number; w: number };
  readonly material?: string;
  readonly thickness?: number;
  readonly holes: readonly { x: number; y: number; z: number; r: number; depth: number }[];
}
export function buildObjects(path: string): {
  readonly panels: readonly B3dObject[];
  readonly hardware: readonly B3dObject[];
};
