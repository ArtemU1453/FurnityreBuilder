import type { HardwareBOM, HardwareItem } from './types.js';

/**
 * Технический вывод спецификации (PROMPT 16 §26).
 *
 * Показывает ровно те поля, которые требует задание: идентификатор,
 * определение, категорию, количество, единицу, источник, правило и
 * причину. Формулы здесь нет ни одной — как и в `buildDebugView`,
 * функция только раскладывает уже посчитанное в строки, поэтому её можно
 * читать как доказательство трассируемости: по каждой позиции видно, какое
 * правило и какой источник её породили (§5).
 *
 * Строки, а не JSX: тот же вывод нужен и тестам, и консоли, и панели
 * разработчика, а разметка нужна только последней.
 */

const HEADER = 'ID · DEFINITION · CATEGORY · QUANTITY · UNIT · SOURCE · RULE · REASON';

function sourceOf(item: HardwareItem): string {
  const parts: string[] = [];
  if (item.sourcePartId !== undefined) parts.push(`деталь ${String(item.sourcePartId)}`);
  if (item.sourceNodeId !== undefined) parts.push(`узел ${String(item.sourceNodeId)}`);
  return parts.length === 0 ? '—' : parts.join(' + ');
}

export function formatHardwareItem(item: HardwareItem): string {
  return [
    item.id,
    String(item.definitionId),
    item.kind,
    String(item.quantity),
    item.unit,
    sourceOf(item),
    item.ruleId,
    item.reason,
  ].join(' · ');
}

export function formatHardwareDebug(bom: HardwareBOM): readonly string[] {
  const lines: string[] = [HEADER];
  if (bom.items.length === 0) lines.push('— ни одной позиции не рассчитано —');
  for (const item of bom.items) lines.push(formatHardwareItem(item));
  for (const line of bom.lines) {
    lines.push(
      `ИТОГО · ${String(line.definitionId)} · ${line.kind} · ${String(line.quantity)} · ${line.unit} · источников: ${String(line.sources.length)} · ${line.name}`,
    );
  }
  for (const warning of bom.warnings) lines.push(`ПРЕДУПРЕЖДЕНИЕ · ${warning.code} · ${warning.message}`);
  for (const error of bom.errors) lines.push(`ОШИБКА · ${error.code} · ${error.message}`);
  return lines;
}
