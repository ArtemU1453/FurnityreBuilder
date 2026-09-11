/** Типы исследовательского парсера .b3d (PROMPT 66 §3). Вне продуктового слоя. */
export interface B3dNode {
  readonly id: number;
  readonly tag: number;
  readonly fields: Record<string, string | number | null | { blob: number }>;
}
export interface B3dParseResult {
  readonly offset: number;
  readonly keys: readonly string[];
  readonly nodes: readonly B3dNode[];
  readonly stats: { fields: number; markers: number };
  readonly stoppedAt: number;
  readonly reason: string;
}
export function parseB3d(path: string): B3dParseResult;
