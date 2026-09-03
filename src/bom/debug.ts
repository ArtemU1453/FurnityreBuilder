import { formatMm } from '../domain/index.js';
import type { EdgeSpec } from '../domain/index.js';
import type { ProductionCalculationResult } from './types.js';

/**
 * Технический вывод производственной спецификации (PROMPT 19 §25).
 *
 * Четыре раздела ровно в том составе, который перечисляет задание.
 * Расчётов здесь нет ни одного: все числа приходят готовыми из
 * `calculateProduction`. Это инструмент проверки конвейера, а не
 * производственный интерфейс (§33: финальный UI не делается).
 */

const edgeOf = (edge: EdgeSpec): string =>
  `${String(edge.front)}/${String(edge.back)}/${String(edge.left)}/${String(edge.right)}`;

const percent = (value: number): string => `${(value * 100).toFixed(1)} %`;

export function formatProductionDebug(result: ProductionCalculationResult): readonly string[] {
  const { bom } = result;
  const lines: string[] = [`СТАТУС: ${result.status} · версия спецификации ${String(bom.version)}`];

  lines.push('ДЕТАЛИ · ID · NAME · TYPE · MATERIAL · THICKNESS · LENGTH · WIDTH · QTY · EDGE');
  if (bom.parts.length === 0) lines.push('  — ни одной детали —');
  for (const part of bom.parts) {
    lines.push(
      `  ${part.id} · ${part.name} · ${part.partType} · ${part.materialName} · ${formatMm(part.thickness)} · ${formatMm(part.length)} · ${formatMm(part.width)} · ${String(part.quantity)} · ${edgeOf(part.edgeBanding)}`,
    );
  }

  if (bom.edgeBanding.length > 0) {
    lines.push('КРОМКА · MATERIAL · THICKNESS · LENGTH · SIDES');
    for (const edge of bom.edgeBanding) {
      lines.push(`  ${edge.materialName} · ${formatMm(edge.thickness)} · ${formatMm(edge.lengthMm)} · ${String(edge.sideCount)}`);
    }
  }

  lines.push('ФУРНИТУРА · DEFINITION · CATEGORY · QTY · SOURCE');
  if (bom.hardware.lines.length === 0) lines.push('  — ни одной позиции —');
  for (const line of bom.hardware.lines) {
    lines.push(`  ${String(line.definitionId)} · ${line.kind} · ${String(line.quantity)} ${line.unit} · источников: ${String(line.sources.length)}`);
  }

  lines.push(`ПРИСАДКА · операций: ${String(bom.drilling.operationCount)} · деталей: ${String(bom.drilling.partCount)}`);
  for (const item of bom.drilling.items) {
    lines.push(
      `  ${item.partName} · ${item.faces.join(',')} · ${item.purposes.join(',')} · ${String(item.operationCount)}`,
    );
  }

  const cutting = bom.cutting;
  lines.push(
    `РАСКРОЙ · листов: ${String(cutting.stockCount)} · использовано ${percent(cutting.utilization)} · отход ${formatMm(Math.round(cutting.wasteArea / 100) / 100)} дм² · размещено ${String(cutting.placedParts)} · не размещено ${String(cutting.unplacedParts)}`,
  );
  for (const stock of cutting.stocks) {
    lines.push(
      `  ${stock.materialName} · ${formatMm(stock.thickness)} · ${formatMm(stock.stockLength)} × ${formatMm(stock.stockWidth)} · листов ${String(stock.stockQuantity)}`,
    );
  }

  lines.push(`ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ · ${String(bom.confirmations.length)}`);
  for (const item of bom.confirmations) {
    lines.push(`  ${item.category} · ${item.id} · ${item.rule} · ${item.impact}`);
  }

  for (const warning of result.warnings) lines.push(`ПРЕДУПРЕЖДЕНИЕ · ${warning.code} · ${warning.message}`);
  for (const error of result.errors) lines.push(`ОШИБКА · ${error.code} · ${error.message}`);

  return lines;
}
