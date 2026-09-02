/**
 * Клавиатурный слой.
 *
 * Полный сценарий проектирования обязан проходиться без мыши — это не
 * «доступность потом», а требование к архитектуре: любое действие, доступное
 * жестом, должно иметь клавиатурный эквивалент.
 */
export interface KeyBinding {
  readonly id: string;
  readonly keys: string;
  readonly description: string;
}

/** Реестр сочетаний. Единый источник и для обработчиков, и для окна справки. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { id: 'undo', keys: 'Mod+Z', description: 'Отменить' },
  { id: 'redo', keys: 'Mod+Shift+Z', description: 'Вернуть' },
  { id: 'export', keys: 'Mod+S', description: 'Выгрузить проект в файл' },
  { id: 'duplicate', keys: 'Mod+D', description: 'Дублировать секцию' },
  { id: 'delete', keys: 'Delete', description: 'Очистить наполнение ячейки' },
  { id: 'cancel', keys: 'Escape', description: 'Отменить жест, закрыть панель' },
  { id: 'confirm', keys: 'Enter', description: 'Открыть свойства, подтвердить ввод' },
  { id: 'nudge', keys: 'Arrow', description: 'Изменить значение на 1 мм' },
  { id: 'nudge-large', keys: 'Shift+Arrow', description: 'Изменить значение на 10 мм' },
  { id: 'view-front', keys: '1', description: 'Вид: фасад' },
  { id: 'view-section', keys: '2', description: 'Вид: разрез' },
  { id: 'view-plan', keys: '3', description: 'Вид: план' },
  { id: 'view-3d', keys: '4', description: 'Вид: 3D' },
  { id: 'fit', keys: '0', description: 'Вписать в экран' },
  { id: 'help', keys: '?', description: 'Список горячих клавиш' },
];

export interface KeyEventLike {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** Mod — Cmd на macOS, Ctrl на остальных. Различие обрабатывается один раз. */
export function isModifier(event: KeyEventLike): boolean {
  return event.metaKey || event.ctrlKey;
}

export function matchBinding(event: KeyEventLike, binding: KeyBinding): boolean {
  const parts = binding.keys.split('+');
  const key = parts.at(-1) ?? '';
  const needsMod = parts.includes('Mod');
  const needsShift = parts.includes('Shift');

  if (needsMod !== isModifier(event)) return false;
  if (needsShift !== event.shiftKey) return false;
  if (key === 'Arrow') return event.key.startsWith('Arrow');
  return event.key.toLowerCase() === key.toLowerCase();
}

/** Приращение значения стрелками. Совпадает с шагом привязки при перетаскивании. */
export function arrowDelta(event: KeyEventLike): number {
  const magnitude = event.shiftKey ? 10 : event.altKey ? 0.1 : 1;
  switch (event.key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return magnitude;
    case 'ArrowDown':
    case 'ArrowLeft':
      return -magnitude;
    default:
      return 0;
  }
}
