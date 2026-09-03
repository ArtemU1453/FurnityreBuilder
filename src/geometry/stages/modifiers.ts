import { roundMm, vec3 } from '../../domain/index.js';
import type { FalsePanel } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveEffectiveMaterial } from '../parts.js';
import { resolveCountertopGeometry, resolveFalsePanelGeometry } from '../modifiers.js';
import type { CarcassFrame } from '../modifiers.js';
import { resolveBackGeometry, resolveVerticalLayout } from './carcass.js';

/**
 * Конструктивные модификаторы, дающие детали: столешница и фальшпанели
 * (PROMPT 15, этапы `countertop` и `false-panels` конвейера).
 *
 * Этап ничего не вычисляет сам: рамку корпуса он ПЕРЕЧИТЫВАЕТ у тех же
 * функций, что и `carcass` (`resolveBackGeometry`, `resolveVerticalLayout`),
 * а что означает каждый модификатор, решают резолверы `../modifiers.ts`.
 * Второй геометрии корпуса здесь не появляется — это то же разделение
 * «резолвер решает что, этап решает где», что у `fill`, `facades`, `back`
 * и `base`.
 */
export const modifiersStage: GeometryStage = {
  name: 'countertop',
  run(ctx: GeometryContext): void {
    const { furniture, tolerances, edgeSizing, materials } = ctx.input;
    const { back, base, countertop, overhang, topSection, ceilingGap, falsePanels } = furniture.carcass;

    const T = roundMm(furniture.dimensions.panelThickness);
    const backGeom = resolveBackGeometry(back.mount, roundMm(furniture.dimensions.depth), tolerances.depthIncludesBackPanel);
    const layout = resolveVerticalLayout({
      base,
      height: roundMm(furniture.dimensions.height),
      heightIncludesBase: tolerances.heightIncludesBase,
      countertop,
      topSection,
      ceilingGap,
    });

    const frame: CarcassFrame = {
      width: roundMm(furniture.dimensions.width),
      z0: backGeom.carcassZ0,
      depth: backGeom.carcassDepth,
      y0: layout.carcassY0,
      totalTop: layout.totalTop,
    };

    // ── Столешница ────────────────────────────────────────────────────────
    if (countertop !== undefined) {
      const material = resolveEffectiveMaterial({
        materials,
        role: 'countertop',
        explicitMaterialId: countertop.materialId,
        explicitEdge: countertop.edge,
        thicknessOverride: countertop.thickness,
        corpusThickness: T,
      });
      if (material.danglingMaterialId) {
        ctx.report('MATERIAL_REFERENCE_BROKEN', 'error', 'Столешница: указанный материал не найден в библиотеке.', {
          path: 'carcass.countertop.materialId',
        });
      }
      if (material.roleNotAssigned) {
        ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для столешницы не назначен, взят первый из библиотеки.');
      }

      const resolution = resolveCountertopGeometry(
        countertop,
        frame,
        layout.countertopY0,
        overhang !== undefined && overhang.appliesTo.includes('countertop') ? overhang : undefined,
      );

      if (resolution.status === 'invalid') {
        ctx.report(
          'COUNTERTOP_GEOMETRY_INVALID',
          'error',
          resolution.missing ?? 'столешница не построена: геометрия недопустима.',
          { path: 'carcass.countertop' },
        );
      } else if (resolution.countertop !== undefined) {
        const c = resolution.countertop;
        ctx.addPart(
          makePart({
            furnitureId: furniture.id,
            role: 'countertop',
            label: 'Столешница',
            index: 0,
            position: vec3(c.x, c.y, c.z),
            size: vec3(c.width, c.height, c.depth),
            orientation: 'horizontal-xz',
            materialId: material.materialId,
            edge: material.edge,
            edgeSizing,
          }),
        );
      }
    }

    // ── Фальшпанели ───────────────────────────────────────────────────────
    const panels = falsePanels ?? [];
    if (panels.length === 0) return;

    // Материал каждой панели считается ОДИН раз и переиспользуется и для
    // толщины, и для самой детали — тот же приём, что у двери и фасада
    // ящика (PROMPT 13 §9).
    const panelMaterials = new Map(
      panels.map((panel) => [
        panel.id,
        resolveEffectiveMaterial({
          materials,
          role: 'filler',
          explicitMaterialId: panel.materialId,
          explicitEdge: panel.edge,
          thicknessOverride: panel.thickness,
          corpusThickness: T,
        }),
      ]),
    );

    const resolution = resolveFalsePanelGeometry(panels, frame, (panel: FalsePanel) => panelMaterials.get(panel.id)?.thickness ?? T);

    if (resolution.status === 'invalid') {
      ctx.report(
        'FALSE_PANEL_GEOMETRY_INVALID',
        'error',
        resolution.missing ?? 'фальшпанель не построена: геометрия недопустима.',
        { path: 'carcass.falsePanels' },
      );
      return;
    }

    for (const panel of resolution.panels) {
      const material = panelMaterials.get(panel.panelId);
      if (material?.danglingMaterialId === true) {
        ctx.report('MATERIAL_REFERENCE_BROKEN', 'error', 'Фальшпанель: указанный материал не найден в библиотеке.', {
          path: 'carcass.falsePanels',
        });
      }
      if (material?.roleNotAssigned === true) {
        ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', 'Материал для фальшпанели не назначен, взят первый из библиотеки.');
      }
      ctx.addPart(
        makePart({
          furnitureId: furniture.id,
          role: 'filler',
          label: 'Фальшпанель',
          // Идентичность — собственный id панели, а не порядковый номер:
          // удаление соседней панели не должно переименовывать эту (§15).
          index: panel.panelId,
          position: vec3(panel.x, panel.y, panel.z),
          size: vec3(panel.width, panel.height, panel.depth),
          orientation: panel.width < panel.height ? 'vertical-yz' : 'horizontal-xz',
          materialId: material?.materialId ?? resolveEffectiveMaterial({ materials, role: 'filler', corpusThickness: T }).materialId,
          edge: material?.edge ?? { front: 0, back: 0, left: 0, right: 0 },
          edgeSizing,
        }),
      );
    }
  },
};
