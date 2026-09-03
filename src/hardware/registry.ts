import type { HardwareDefinition, HardwareId, HardwareLibrary } from '../domain/index.js';
import { asId } from '../domain/index.js';

/**
 * Стартовый реестр фурнитуры (PROMPT 16 §3).
 *
 * Заполняет уже существующий `HardwareLibrary` — второго реестра не
 * заводится. Позиции нейтральные и описательные: ни брендов, ни артикулов,
 * ни каталогов производителей (§3, §29 и требование автономности
 * `docs/BRAND_INDEPENDENCE_AUDIT.md`). Реестр отвечает на вопрос «что это
 * за позиция», а не «чья она».
 *
 * Характеристики (`spec`) намеренно минимальны: угол петли, тип
 * направляющей и длину крепежа референс не подтвердил, а выдумывать их
 * значило бы притвориться, что каталог есть.
 */

export const HW_HINGE: HardwareId = asId<'Hardware'>('hw-hinge');
export const HW_HINGE_FASTENER: HardwareId = asId<'Hardware'>('hw-hinge-fastener');
export const HW_SLIDE: HardwareId = asId<'Hardware'>('hw-slide');
export const HW_SHELF_SUPPORT: HardwareId = asId<'Hardware'>('hw-shelf-support');
export const HW_BACK_FASTENER: HardwareId = asId<'Hardware'>('hw-back-fastener');
export const HW_CARCASS_FASTENER: HardwareId = asId<'Hardware'>('hw-carcass-fastener');
export const HW_HANDLE: HardwareId = asId<'Hardware'>('hw-handle');
export const HW_HANDLE_FASTENER: HardwareId = asId<'Hardware'>('hw-handle-fastener');
export const HW_PUSH_LATCH: HardwareId = asId<'Hardware'>('hw-push-latch');

const DEFINITIONS: readonly HardwareDefinition[] = [
  { id: HW_HINGE, kind: 'hinge', name: 'Петля', unit: 'pcs', spec: {} },
  { id: HW_HINGE_FASTENER, kind: 'hinge-fastener', name: 'Крепёж петли', unit: 'pcs', spec: {} },
  { id: HW_SLIDE, kind: 'slide', name: 'Направляющая', unit: 'pcs', spec: {} },
  { id: HW_SHELF_SUPPORT, kind: 'shelf-support', name: 'Полкодержатель', unit: 'pcs', spec: {} },
  { id: HW_BACK_FASTENER, kind: 'back-nail', name: 'Крепёж задней стенки', unit: 'pcs', spec: {} },
  { id: HW_CARCASS_FASTENER, kind: 'confirmat', name: 'Крепёж корпуса', unit: 'pcs', spec: {} },
  { id: HW_HANDLE, kind: 'handle', name: 'Ручка', unit: 'pcs', spec: {} },
  { id: HW_HANDLE_FASTENER, kind: 'handle-fastener', name: 'Крепёж ручки', unit: 'pcs', spec: {} },
  { id: HW_PUSH_LATCH, kind: 'push-latch', name: 'Механизм push-to-open', unit: 'pcs', spec: {} },
];

/** Реестр по умолчанию: тот же приём, что `createDefaultMaterials`. */
export function createDefaultHardwareLibrary(): HardwareLibrary {
  return { items: Object.fromEntries(DEFINITIONS.map((d) => [d.id, d])) };
}

/**
 * `@__PURE__` — не украшение: без аннотации сборщик не может доказать, что
 * вызов на верхнем уровне модуля безвреден, и тащит весь реестр в
 * production-бандл, где расчёта фурнитуры пока нет вовсе (§29 исключает
 * производственный интерфейс). Тот же приём, что уже держит debug-рендерер
 * вне production-сборки.
 */
export const DEFAULT_HARDWARE_LIBRARY: HardwareLibrary = /* @__PURE__ */ createDefaultHardwareLibrary();
