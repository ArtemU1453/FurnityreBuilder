import { formatDirection, operationToWorld } from '../drilling/index.js';
import type { Part, Project } from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';
import type { ProductionCalculationResult } from '../bom/index.js';
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

const PURPOSE_LABELS: Readonly<Record<string, string>> = {
  hinge: 'петля',
  'hinge-fastener': 'крепёж петли',
  slide: 'направляющая',
  'shelf-support': 'полкодержатель',
  handle: 'ручка',
  'handle-fastener': 'крепёж ручки',
  'push-latch': 'push-механизм',
  confirmat: 'корпусный крепёж',
  eccentric: 'эксцентрик',
  dowel: 'шкант',
  'back-nail': 'крепёж задней стенки',
  rod: 'штанга',
  'rod-flange': 'фланец штанги',
  leg: 'опора',
  'plinth-clip': 'клипса цоколя',
};

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
    partType: item.partType,
    category: item.category,
    quantity: item.quantity,
    length: mmValue(item.length),
    width: mmValue(item.width),
    thickness: mmValue(item.thickness),
    materialId: String(item.materialId),
    materialName: item.materialName,
    edge: edgeText(item.edgeBanding),
    grain: item.grainDirection,
    sourcePartIds: item.sourcePartIds.map((id) => String(id)),
  }));

  const hardware: ExportHardwareRow[] = bom.hardware.lines.map((line, index) => ({
    index: index + 1,
    definitionId: String(line.definitionId),
    name: line.name,
    category: line.kind,
    quantity: line.quantity,
    unit: line.unit,
    purpose: PURPOSE_LABELS[line.kind] ?? line.kind,
    // Источник позиции — деталь или узел модели: по нему в будущем можно
    // подсветить, откуда взялась строка спецификации (§12).
    sources: line.sources.map((item) => String(item.sourcePartId ?? item.sourceNodeId ?? '—')),
    ruleId: line.sources[0]?.ruleId ?? '',
  }));

  const partNameById = new Map(bom.parts.map((item) => [item.id, item.name]));

  const drilling: ExportDrillingRow[] = result.drilling.operations.map((operation, index) => {
    const part = partsById.get(String(operation.sourcePartId));
    const world = part === undefined ? undefined : operationToWorld(operation, part);
    return {
      index: index + 1,
      partId: operation.productionPartId,
      partName: partNameById.get(operation.productionPartId) ?? operation.productionPartId,
      operationId: operation.id,
      purpose: operation.purpose,
      face: operation.face,
      x: mmValue(operation.x),
      y: mmValue(operation.y),
      worldX: mmValue(world?.point.x ?? 0),
      worldY: mmValue(world?.point.y ?? 0),
      worldZ: mmValue(world?.point.z ?? 0),
      diameter: mmValue(operation.diameter),
      depth: mmValue(operation.depth),
      direction: world === undefined ? '—' : formatDirection(world.direction),
      through: operation.through,
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
        kind: material?.kind ?? 'other',
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
    },
    dimensions: {
      width: mmValue(furniture?.dimensions.width ?? 0),
      height: mmValue(furniture?.dimensions.height ?? 0),
      depth: mmValue(furniture?.dimensions.depth ?? 0),
      panelThickness: mmValue(furniture?.dimensions.panelThickness ?? 0),
      constructionScheme:
        SCHEME_LABELS[project.settings.construction.verticalPriority] ??
        project.settings.construction.verticalPriority,
      backPanel: furniture?.carcass.back.mount.kind ?? '—',
      base:
        furniture?.carcass.base === undefined
          ? 'нет'
          : `${furniture.carcass.base.kind}, ${String(mmValue(furniture.carcass.base.height))} мм`,
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
    warnings: result.warnings.map((issue) => `${issue.code}: ${issue.message}`),
    errors: result.errors.map((issue) => `${issue.code}: ${issue.message}`),
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
