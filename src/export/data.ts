import { drillThroughLabel, formatDirection, operationToWorld } from '../drilling/index.js';
import {
  backMountLabel,
  baseKindLabel,
  drillFaceLabel,
  drillPurposeLabel,
  grainLabel,
  hardwareKindLabel,
  hardwareUnitLabel,
  materialKindLabel,
} from '../domain/index.js';
import type { Part, PartId, Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import { calculationStatusLabel, partCategoryLabel } from '../bom/index.js';
import { productionPartTypeLabel, unplacedReasonLabel } from '../production/index.js';
import type { PartBOMItem, ProductionCalculationResult } from '../bom/index.js';
import { areaM2, edgeText, lengthM, mmValue, percentValue } from './format.js';
import { buildPartDrawings, operationsOfItem } from './part-drawing.js';
import type {
  ExportCuttingSheet,
  ExportDrillingRow,
  ExportEdgeRow,
  ExportHardwareRow,
  ExportMaterialRow,
  ExportPartRow,
  ExportPlacementRow,
  ExportUnplacedRow,
  ProductionExportData,
} from './types.js';

/**
 * Расчёт → данные документа (PROMPT 20 §2).
 *
 * Здесь НЕ считается ничего производственного: ни размеров, ни количеств,
 * ни раскладки. Всё приходит из `ProductionCalculationResult`, а функция
 * только раскладывает готовые числа по строкам таблиц и округляет их для
 * отображения. Второго расчётного движка не появляется — это и есть
 * смысл отдельного слоя (§1, §21).
 */

export interface BuildExportDataOptions {
  /**
   * Момент генерации. Передаётся снаружи, а не читается из часов: иначе
   * функция перестала бы быть чистой, а сравнить два экспорта было бы
   * нельзя (§13).
   */
  readonly generatedAt: string;
  readonly appVersion?: string;
  /** Готовая геометрия: нужна мировым координатам отверстий. */
  readonly geometry?: ReadonlyMap<string, GeometryResult>;
}

/*
  Здесь стоял ВТОРОЙ словарь видов фурнитуры — `PURPOSE_LABELS`. Он
  покрывал то же перечисление `HardwareKind`, что и словарь интерфейса,
  и называл три значения иначе: `confirmat` был «корпусным крепежом»
  против «конфирмата», `eccentric` — «эксцентриком» против
  «эксцентриковой стяжки», `back-nail` — «крепежом задней стенки»
  против «гвоздя задней стенки». Экран и выгрузка расходились в словах
  для одного и того же (PROMPT 62 §4).

  Словарь теперь один и лежит в домене, откуда его видят все слои.
*/

/**
 * Одинаковые источники складываются: «Полка ×4», а не «Полка, Полка,
 * Полка, Полка». Шестнадцать полкодержателей на четыре полки давали в
 * колонке четыре одинаковых слова подряд.
 */
function dedupeSources(labels: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, count]) => (count === 1 ? label : `${label} ×${String(count)}`));
}

/**
 * Чем названа деталь-источник позиции фурнитуры (PROMPT 62 §9).
 *
 * Имя берётся из деталировки — той же таблицы, что и на листе «Детали»,
 * поэтому строка спецификации и строка раскроя называют одну деталь
 * одинаково. Сопоставление «UUID → слово» здесь не выдумывается: оно
 * уже есть в модели, `PartBOMItem.sourcePartIds`.
 *
 * Когда источник — узел модели, а не деталь (позиция приписана ячейке
 * или створке), имени детали не существует, и честнее показать причину
 * появления позиции: её правило формулирует по-человечески.
 */
function sourceLabel(
  items: readonly PartBOMItem[],
  source: { readonly sourcePartId?: PartId; readonly reason: string },
): string {
  const partId = source.sourcePartId;
  if (partId === undefined) return source.reason;
  return items.find((item) => item.sourcePartIds.includes(partId))?.name ?? source.reason;
}

const SCHEME_LABELS: Readonly<Record<string, string>> = {
  'sides-through': 'боковины проходят насквозь',
  'horizontals-through': 'горизонты проходят насквозь',
  mixed: 'смешанная',
};

export function buildProductionExportData(
  project: Project,
  result: ProductionCalculationResult,
  options: BuildExportDataOptions,
): ProductionExportData {
  const furniture = project.furniture[0];
  const { bom } = result;

  // Физические детали нужны только для мировых координат отверстий:
  // операция хранит локальные, а мировые вычисляются переходом
  // (`docs/DRILLING_RULES.md` §2). Второго источника координат нет.
  const partsById = new Map<string, Part>();
  for (const geometry of options.geometry?.values() ?? []) {
    for (const part of geometry.parts) partsById.set(part.id, part);
  }

  const parts: ExportPartRow[] = bom.parts.map((item, index) => ({
    index: index + 1,
    id: item.id,
    name: item.name,
    // Машинное значение остаётся в модели выгрузки — по нему можно
    // отбирать и сверять; в документ печатается подпись (PROMPT 62 §5).
    partType: item.partType,
    partTypeLabel: productionPartTypeLabel(item.partType),
    category: item.category,
    categoryLabel: partCategoryLabel(item.category),
    quantity: item.quantity,
    length: mmValue(item.length),
    width: mmValue(item.width),
    thickness: mmValue(item.thickness),
    materialId: String(item.materialId),
    materialName: item.materialName,
    edge: edgeText(item.edgeBanding),
    grain: item.grainDirection,
    grainLabel: grainLabel(item.grainDirection),
    sourcePartIds: item.sourcePartIds.map((id) => String(id)),
  }));

  const hardware: ExportHardwareRow[] = bom.hardware.lines.map((line, index) => ({
    index: index + 1,
    definitionId: String(line.definitionId),
    name: line.name,
    category: line.kind,
    categoryLabel: hardwareKindLabel(line.kind),
    quantity: line.quantity,
    unit: line.unit,
    unitLabel: hardwareUnitLabel(line.unit),
    purpose: hardwareKindLabel(line.kind),
    /*
      Источник позиции (PROMPT 62 §9).

      Печатался сам `PartId` — `part:uuid/uuid/роль/uuid`. В строке
      «Полкодержатели» их было четыре, около двухсот знаков. Теперь
      печатается имя детали из деталировки — то же, что человек видит в
      таблице выше и найдёт на чертеже. Прослеживаемость не потеряна:
      идентификаторы физических деталей остаются в колонке
      `sourcePartIds` листа «Детали».
    */
    sources: dedupeSources(line.sources.map((item) => sourceLabel(bom.parts, item))),
    ruleId: line.sources[0]?.ruleId ?? '',
  }));

  /*
    Имя детали по идентификатору ПРОИЗВОДСТВЕННОЙ детали (PROMPT 62 §5).

    Карта строилась по `item.id` — ключу позиции спецификации
    (`bom:back|…`), а искали в ней по `productionPartId` (`pp:back|…`).
    Совпадения не случалось никогда, и во все листы — раскроя, присадки,
    неразмещённых — уходил запасной вариант: сам машинный ключ. Позиция
    знает свои производственные детали полем `productionPartIds`; по нему
    карта и строится.
  */
  const partNameById = new Map(
    bom.parts.flatMap((item) => item.productionPartIds.map((id) => [id, item.name] as const)),
  );

  const drilling: ExportDrillingRow[] = result.drilling.operations.map((operation, index) => {
    const part = partsById.get(String(operation.sourcePartId));
    const world = part === undefined ? undefined : operationToWorld(operation, part);
    return {
      index: index + 1,
      partId: operation.productionPartId,
      partName: partNameById.get(operation.productionPartId) ?? operation.productionPartId,
      operationId: operation.id,
      purpose: operation.purpose,
      purposeLabel: drillPurposeLabel(operation.purpose),
      face: operation.face,
      faceLabel: drillFaceLabel(operation.face),
      x: mmValue(operation.x),
      y: mmValue(operation.y),
      worldX: mmValue(world?.point.x ?? 0),
      worldY: mmValue(world?.point.y ?? 0),
      worldZ: mmValue(world?.point.z ?? 0),
      diameter: mmValue(operation.diameter),
      depth: mmValue(operation.depth),
      direction: world === undefined ? '—' : formatDirection(world.direction),
      through: drillThroughLabel(operation.through),
    };
  });

  const placements: ExportPlacementRow[] = [];
  const sheets: ExportCuttingSheet[] = [];
  result.cutting.layouts.forEach((layout, sheetIndex) => {
    const material = project.materials.items[layout.stock.materialId];
    const usableX = layout.stock.trimLeft;
    const usableY = layout.stock.trimBottom;
    sheets.push({
      id: layout.id,
      sheetNumber: sheetIndex + 1,
      materialName: material?.name ?? String(layout.stock.materialId),
      thickness: mmValue(layout.stock.thickness),
      stockLength: mmValue(layout.stock.length),
      stockWidth: mmValue(layout.stock.width),
      usable: {
        x: mmValue(usableX),
        y: mmValue(usableY),
        length: mmValue(layout.stock.length - layout.stock.trimLeft - layout.stock.trimRight),
        width: mmValue(layout.stock.width - layout.stock.trimTop - layout.stock.trimBottom),
      },
      kerf: mmValue(layout.stock.kerf),
      utilization: percentValue(layout.utilization),
      wasteArea: areaM2(layout.wasteArea),
      placements: layout.placements.map((placement) => ({
        partId: placement.productionPartId,
        partName: partNameById.get(placement.productionPartId) ?? placement.productionPartId,
        x: mmValue(placement.x),
        y: mmValue(placement.y),
        width: mmValue(placement.width),
        height: mmValue(placement.height),
        rotation: placement.rotation,
      })),
    });

    for (const placement of layout.placements) {
      placements.push({
        index: placements.length + 1,
        stockId: layout.stockId,
        sheetNumber: sheetIndex + 1,
        stockLength: mmValue(layout.stock.length),
        stockWidth: mmValue(layout.stock.width),
        partId: placement.productionPartId,
        partName: partNameById.get(placement.productionPartId) ?? placement.productionPartId,
        x: mmValue(placement.x),
        y: mmValue(placement.y),
        width: mmValue(placement.width),
        height: mmValue(placement.height),
        rotation: placement.rotation,
        kerf: mmValue(layout.stock.kerf),
        utilization: percentValue(layout.utilization),
        wasteArea: areaM2(layout.wasteArea),
      });
    }
  });

  const unplaced: ExportUnplacedRow[] = result.cutting.unplaced.map((item) => ({
    partId: item.productionPartId,
    partName: partNameById.get(item.productionPartId) ?? item.productionPartId,
    instance: item.instanceIndex + 1,
    reason: item.reason,
    reasonLabel: unplacedReasonLabel(item.reason),
    detail: item.detail,
  }));

  // Сводка по материалам: количество позиций, штук и площадь. Площадь —
  // сумма площадей деталей, а не листов: это расход материала на изделие,
  // а число листов приходит из раскроя и стоит в отдельной колонке.
  const materialAccumulator = new Map<
    string,
    { positions: number; quantity: number; areaMm2: number }
  >();
  for (const item of bom.parts) {
    const key = String(item.materialId);
    const current = materialAccumulator.get(key) ?? { positions: 0, quantity: 0, areaMm2: 0 };
    materialAccumulator.set(key, {
      positions: current.positions + 1,
      quantity: current.quantity + item.quantity,
      areaMm2: current.areaMm2 + item.length * item.width * item.quantity,
    });
  }
  const sheetsByMaterial = new Map<string, number>();
  for (const stock of bom.cutting.stocks) {
    const key = String(stock.materialId);
    sheetsByMaterial.set(key, (sheetsByMaterial.get(key) ?? 0) + stock.stockQuantity);
  }

  const materials: ExportMaterialRow[] = [...materialAccumulator.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([materialId, value], index) => {
      const material = project.materials.items[materialId];
      return {
        index: index + 1,
        materialId,
        name: material?.name ?? materialId,
        kind: materialKindLabel(material?.kind ?? 'other'),
        thickness: mmValue(material?.thickness ?? 0),
        partPositions: value.positions,
        partQuantity: value.quantity,
        areaM2: areaM2(value.areaMm2),
        sheetCount: sheetsByMaterial.get(materialId) ?? 0,
      };
    });

  const edgeBanding: ExportEdgeRow[] = bom.edgeBanding.map((edge, index) => ({
    index: index + 1,
    materialName: edge.materialName,
    thickness: mmValue(edge.thickness),
    lengthM: lengthM(edge.lengthMm),
    sideCount: edge.sideCount,
  }));

  // Чертежи — только для деталей, у которых есть что чертить сверх
  // габарита: отверстия. Лист с прямоугольником и двумя размерами не несёт
  // информации сверх строки спецификации и только раздувает документ.
  //
  // Модель чертежа общая с экраном (PROMPT 29 §14): `buildPartDrawings`
  // — то же самое, что показывает просмотрщик деталей, поэтому чертёж в
  // документе и чертёж на экране не могут разойтись.
  const drawings = buildPartDrawings(
    bom.parts.filter((item) => operationsOfItem(item, result.drilling.byProductionPart).length > 0),
    result.drilling.byProductionPart,
  );

  return {
    metadata: {
      projectName: project.name,
      furnitureName: furniture?.name ?? '—',
      generatedAt: options.generatedAt,
      appVersion: options.appVersion ?? project.metadata.appVersion,
      bomVersion: bom.version,
      status: result.status,
      statusLabel: calculationStatusLabel(result.status),
    },
    dimensions: {
      width: mmValue(furniture?.dimensions.width ?? 0),
      height: mmValue(furniture?.dimensions.height ?? 0),
      depth: mmValue(furniture?.dimensions.depth ?? 0),
      panelThickness: mmValue(furniture?.dimensions.panelThickness ?? 0),
      constructionScheme:
        SCHEME_LABELS[project.settings.construction.verticalPriority] ??
        project.settings.construction.verticalPriority,
      backPanel:
        furniture === undefined ? '—' : backMountLabel(furniture.carcass.back.mount.kind),
      base:
        furniture?.carcass.base === undefined
          ? 'нет'
          : `${baseKindLabel(furniture.carcass.base.kind)}, ${String(mmValue(furniture.carcass.base.height))} мм`,
    },
    parts,
    drawings,
    hardware,
    drilling,
    placements,
    unplaced,
    sheets,
    materials,
    edgeBanding,
    edgeSummary: bom.edgeBanding,
    confirmations: bom.confirmations,
    /*
      Сначала то, что это значит, потом откуда оно (PROMPT 62 §16).

      Было `DRAWER_BOX_NOT_IMPLEMENTED: Короб ящика …` — машинный код
      первым словом строки, которую читает человек. Сообщение уже
      человеческое; код — прослеживаемость, и остаётся ею, только
      позади, а не впереди.
    */
    warnings: result.warnings.map((issue) => `${issue.message} [${issue.code}]`),
    errors: result.errors.map((issue) => `${issue.message} [${issue.code}]`),
    totals: {
      partPositions: parts.length,
      partQuantity: parts.reduce((sum, row) => sum + row.quantity, 0),
      hardwarePositions: hardware.length,
      drillingOperations: drilling.length,
      sheetCount: bom.cutting.stockCount,
      utilization: percentValue(bom.cutting.utilization),
      unplaced: unplaced.length,
    },
  };
}
