import type { ObstacleKind, OpeningKind, Room, Wall } from '../../domain/index.js';

/**
 * Проёмы и препятствия помещения: словарь и разумные заготовки
 * (PROMPT 33 §22, дефект Д-001).
 *
 * ## Почему модуль, а не константы в компоненте
 *
 * Здесь два вида знания, и оба не про разметку: как называются виды
 * проёмов и препятствий по-русски и какие размеры подставлять по
 * умолчанию. Первое обязано совпадать с подписями в сцене
 * (`scene/room-scene.ts`), второе — правило, а не оформление.
 *
 * Модуль чистый: ни React, ни DOM. Значит проверяется обычным тестом, а
 * не через браузер.
 *
 * ## Про значения по умолчанию
 *
 * Это НЕ подтверждённые нормы и не выдаются за них. Дверь 900 × 2100 и
 * окно 1200 × 1400 с подоконником 800 — распространённые бытовые
 * размеры, взятые как отправная точка, которую пользователь тут же
 * правит. Ошибиться здесь безопасно: проём не влияет ни на одну деталь
 * изделия, он нужен, чтобы шкаф не встал в дверь.
 */

export const OPENING_LABELS: Readonly<Record<OpeningKind, string>> = {
  door: 'Дверь',
  window: 'Окно',
  other: 'Другой проём',
};

export const OBSTACLE_LABELS: Readonly<Record<ObstacleKind, string>> = {
  protrusion: 'Выступ стены',
  column: 'Колонна',
  pipe: 'Труба',
  radiator: 'Радиатор',
  other: 'Другое',
};

/** Размеры проёма, с которых начинается правка. */
export interface OpeningDraft {
  readonly position: number;
  readonly width: number;
  readonly height: number;
  readonly sillHeight: number;
}

const OPENING_DRAFTS: Readonly<Record<OpeningKind, Omit<OpeningDraft, 'position'>>> = {
  door: { width: 900, height: 2100, sillHeight: 0 },
  window: { width: 1200, height: 1400, sillHeight: 800 },
  other: { width: 800, height: 1000, sillHeight: 400 },
};

/**
 * Заготовка проёма для выбранной стены.
 *
 * Положение — по середине стены, а не в нуле: проём в самом углу
 * пришлось бы двигать всегда, а по центру он чаще всего уже на месте.
 * Ширина ограничивается длиной стены: проём шире стены — не «почти
 * верно», а невозможно.
 */
export function openingDraftOf(kind: OpeningKind, wall: Wall | undefined): OpeningDraft {
  const base = OPENING_DRAFTS[kind];
  if (wall === undefined) return { position: 0, ...base };
  const length = wallLength(wall);
  const width = Math.min(base.width, length);
  return { position: Math.max(0, Math.round((length - width) / 2)), ...base, width };
}

/** Длина стены по её концам. */
export function wallLength(wall: Wall): number {
  return Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
}

/** Человеческое имя стены: «Стена 1» в том же порядке, что в инспекторе. */
export function wallLabel(room: Room, wallId: Wall['id']): string {
  const index = room.walls.findIndex((wall) => wall.id === wallId);
  return index < 0 ? 'Стена' : `Стена ${String(index + 1)}`;
}

/** Размеры препятствия по виду. Как и у проёмов — отправная точка, не норма. */
export function obstacleSizeOf(kind: ObstacleKind): { x: number; y: number; z: number } {
  switch (kind) {
    case 'column':
      return { x: 400, y: 2500, z: 400 };
    case 'pipe':
      return { x: 100, y: 2500, z: 100 };
    case 'radiator':
      return { x: 900, y: 600, z: 120 };
    case 'protrusion':
      return { x: 500, y: 2500, z: 300 };
    case 'other':
      return { x: 400, y: 400, z: 400 };
  }
}

/**
 * Помещается ли проём в стену целиком.
 *
 * Проверка нужна ДО команды: `AddOpening` отказывает молча, и без
 * подсказки пользователь нажимал бы кнопку впустую. Тот же довод, что у
 * проверки габаритов в конструкторе.
 */
export function openingFits(wall: Wall | undefined, position: number, width: number): boolean {
  if (wall === undefined) return false;
  if (!(width > 0) || position < 0) return false;
  return position + width <= wallLength(wall) + 0.05;
}
