import { z } from 'zod';

/**
 * Схема сохранённого документа.
 *
 * Существует потому, что импортируемый файл — недоверенный вход. Пользователь
 * может подсунуть чужой JSON, обрезанный файл или документ будущей версии;
 * ни один из этих случаев не должен приводить приложение в сломанное состояние.
 * Разбор идёт ДО попадания данных в стор.
 *
 * Идентификаторы в домене брендированы, в JSON это обычные строки. Схема
 * проверяет форму, брендирование восстанавливается приведением в
 * serialization.ts — единственном месте, где это допустимо.
 */

const id = z.string().min(1).max(128);
const mm = z.number().finite();
const positiveMm = z.number().finite().positive();

const edgeThickness = z.union([z.literal(0), z.literal(0.4), z.literal(1), z.literal(2)]);

const edgeSpec = z.object({
  front: edgeThickness,
  back: edgeThickness,
  left: edgeThickness,
  right: edgeThickness,
  materialId: id.optional(),
});

const sheetFormat = z.object({ width: positiveMm, height: positiveMm, trim: mm });

const material = z.object({
  id,
  name: z.string(),
  kind: z.enum(['chipboard', 'mdf', 'plywood', 'hardboard', 'solid', 'glass', 'mirror', 'other']),
  thickness: positiveMm,
  displayColor: z.string(),
  grain: z.enum(['none', 'along-length', 'along-width']),
  sheet: sheetFormat.optional(),
});

const sizeSpec = z.union([
  z.object({ mode: z.literal('fixed'), value: mm }),
  z.object({ mode: z.literal('flex'), weight: z.number().finite() }),
]);

const dividerSpec = z.object({
  material: z.enum(['panel', 'none']),
  thickness: mm,
  mounting: z.enum(['fixed', 'adjustable']),
  frontSetback: mm,
  materialId: id.optional(),
  edge: edgeSpec.optional(),
});

const shelf = z.object({
  id,
  placement: z.union([
    z.object({ mode: z.literal('auto'), index: z.number().int(), count: z.number().int() }),
    z.object({ mode: z.literal('manual'), offsetFromBottom: mm }),
  ]),
  mounting: z.enum(['adjustable', 'fixed']),
  thickness: positiveMm.optional(),
  materialId: id.optional(),
  edge: edgeSpec.optional(),
  frontSetback: mm.optional(),
});

const handleSpec = z.object({
  kind: z.enum(['bar', 'knob', 'profile', 'recessed']),
  lengthMm: mm.optional(),
});

const handlePlacement = z.object({
  anchor: z.enum(['top', 'bottom', 'center']),
  side: z.enum(['left', 'right', 'center']),
  offsetX: mm,
  offsetY: mm,
  offsetZ: mm,
  orientation: z.enum(['horizontal', 'vertical']),
});

const pushToOpenConfig = z.object({
  mechanismType: z.literal('push-latch'),
  position: handlePlacement,
  clearance: mm,
});

/**
 * Способ открывания фасада (PROMPT 12). Заменяет прежнее
 * `handle: handleSpec.nullable().optional()`, где `null` неявно означал
 * push-to-open — см. `OpeningSystem` в `src/domain/furniture/types.ts`.
 */
const openingSystem = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('handle'), id, handle: handleSpec, placement: handlePlacement }),
  z.object({ kind: z.literal('push-to-open'), id, pushToOpen: pushToOpenConfig }),
]);

/**
 * Зазоры фасада. Один тип на все виды фасадов (дверь — PROMPT 10, ящик —
 * PROMPT 11): второй, «ящичный» тип зазоров не заводится, см.
 * `DrawerFacadeSpec.overlay` в `src/domain/furniture/types.ts`.
 */
const overlaySpec = z.object({
  mode: z.enum(['overlay', 'inset']),
  gapBetweenLeaves: mm,
  gapTop: mm,
  gapBottom: mm,
  gapSide: mm,
});

const drawer = z.object({
  id,
  size: sizeSpec,
  slide: z.object({
    type: z.enum(['roller', 'ball-full', 'ball-partial', 'hidden-soft-close']),
    nominalLength: positiveMm,
    sideClearance: mm,
  }),
  box: z.object({
    sideHeight: positiveMm,
    bottom: z.object({
      mount: z.enum(['groove', 'nailed-under']),
      thickness: positiveMm,
      grooveDepth: mm.optional(),
      grooveOffsetFromBottom: mm.optional(),
    }),
    materialId: id.optional(),
  }),
  facade: z.object({
    materialId: id.optional(),
    edge: edgeSpec.optional(),
    // Добавлено PROMPT 11: опциональные поля, старые документы без них
    // читаются без миграции — движок берёт толщину корпуса и DEFAULT_OVERLAY.
    thickness: mm.optional(),
    overlay: overlaySpec.optional(),
    // Добавлено PROMPT 12: заменяет прежнее необязательное поле handle
    // на facade (не на Drawer целиком) — старые документы читаются без
    // миграции, Zod без .strict() молча отбрасывает незнакомые ключи.
    opening: openingSystem.optional(),
  }),
});

const hangingRod = z.object({
  id,
  profile: z.enum(['round-25', 'oval-30x15']),
  offsetFromTop: mm,
  offsetFromFront: mm,
  mount: z.enum(['flange', 'endcap']),
});

const leafFill = z.union([
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('shelves'), shelves: z.array(shelf) }),
  z.object({ kind: z.literal('drawers'), drawers: z.array(drawer) }),
  z.object({ kind: z.literal('rod'), rod: hangingRod }),
  z.object({ kind: z.literal('rod+shelf'), rod: hangingRod, shelfAbove: shelf }),
]);

const leafNode = z.object({ id, kind: z.literal('leaf'), fill: leafFill });

type SectionNodeShape = z.infer<typeof leafNode> | {
  id: string;
  kind: 'split';
  axis: 'x' | 'y';
  divider: z.infer<typeof dividerSpec>;
  children: { size: z.infer<typeof sizeSpec>; node: SectionNodeShape }[];
};

const sectionNode: z.ZodType<SectionNodeShape> = z.lazy(() =>
  z.union([
    leafNode,
    z.object({
      id,
      kind: z.literal('split'),
      axis: z.enum(['x', 'y']),
      divider: dividerSpec,
      children: z.array(z.object({ size: sizeSpec, node: sectionNode })).min(1),
    }),
  ]),
);

const backPanelMount = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('overlay'), thickness: positiveMm }),
  z.object({
    kind: z.literal('inset-groove'),
    thickness: positiveMm,
    grooveDepth: mm,
    grooveOffsetFromRear: mm,
  }),
  z.object({ kind: z.literal('inset-flush'), thickness: positiveMm }),
]);

const slidingDoorConfig = z.object({
  trackCount: z.number().int(),
  overlap: mm,
  frontOffset: mm,
  doorCount: z.number().int(),
});

const facadeGroup = z.object({
  id,
  covers: z.union([
    z.object({ kind: z.literal('node'), nodeId: id }),
    z.object({ kind: z.literal('carcass') }),
  ]),
  type: z.enum(['hinged', 'sliding', 'folding', 'lift']),
  leaves: z.array(
    z.object({
      id,
      size: sizeSpec,
      hingeSide: z.enum(['left', 'right', 'top', 'bottom', 'none']),
      materialId: id.optional(),
      edge: edgeSpec.optional(),
      // Добавлено PROMPT 10: опциональное поле, старые документы без него
      // читаются без миграции — движок берёт толщину корпуса по умолчанию.
      thickness: mm.optional(),
      // Добавлено PROMPT 12: заменяет прежнее handle:handleSpec.nullable().optional().
      opening: openingSystem.optional(),
    }),
  ),
  overlay: overlaySpec,
  // Добавлено PROMPT 10: архитектурный контракт для купе, геометрией не
  // читается (T-DOOR-01). Опционально — не влияет на старые документы.
  slidingConfig: slidingDoorConfig.optional(),
});

const furniture = z.object({
  id,
  name: z.string(),
  kind: z.enum(['wardrobe', 'shelving', 'cabinet', 'dresser']),
  dimensions: z.object({
    width: positiveMm,
    height: positiveMm,
    depth: positiveMm,
    panelThickness: positiveMm,
  }),
  carcass: z.object({
    hasTop: z.boolean(),
    hasBottom: z.boolean(),
    back: z.object({
      mount: backPanelMount,
      materialId: id,
      segmentation: z.enum(['single', 'per-section']),
    }),
    base: z
      .object({
        kind: z.enum(['plinth', 'legs', 'none']),
        height: mm,
        setback: mm,
        legCount: z.number().int().optional(),
        // Поля PROMPT 14: состав царг, вырез, материал и толщина цоколя.
        // Все опциональные — старый проект без них читается схемой как есть,
        // отдельная миграция не нужна (docs/DATA_MODEL.md §8).
        parts: z.array(z.enum(['front', 'left', 'right', 'rear'])).optional(),
        cutout: z.object({ left: mm, right: mm, height: mm }).optional(),
        materialId: id.optional(),
        thickness: positiveMm.optional(),
        edge: edgeSpec.optional(),
      })
      .optional(),
    countertop: z
      .object({
        thickness: positiveMm,
        overhangFront: mm,
        overhangLeft: mm,
        overhangRight: mm,
        overhangBack: mm,
        materialId: id,
        edge: edgeSpec,
      })
      .optional(),
    // Конструктивные модификаторы PROMPT 15. Все опциональные: старый
    // проект без них читается схемой как есть, отдельная миграция не нужна
    // (docs/DATA_MODEL.md §8.1, docs/STRUCTURAL_MODIFIERS.md §7).
    overhang: z
      .object({
        front: mm,
        back: mm,
        left: mm,
        right: mm,
        appliesTo: z.array(z.enum(['top', 'bottom', 'countertop'])),
      })
      .optional(),
    topSection: z
      .object({
        height: positiveMm,
        gap: mm,
        materialId: id.optional(),
        hasTop: z.boolean(),
        hasBottom: z.boolean(),
      })
      .optional(),
    ceilingGap: mm.optional(),
    wallMount: z
      .object({
        mode: z.enum(['floor-standing', 'wall-mounted', 'suspended']),
        wallId: id.optional(),
        elevation: mm.optional(),
      })
      .optional(),
    falsePanels: z
      .array(
        z.object({
          id,
          position: z.enum(['left', 'right', 'top', 'bottom']),
          width: positiveMm.optional(),
          height: positiveMm.optional(),
          depth: positiveMm.optional(),
          materialId: id.optional(),
          thickness: positiveMm.optional(),
          edge: edgeSpec.optional(),
          offset: mm.optional(),
        }),
      )
      .optional(),
  }),
  root: sectionNode,
  facades: z.array(facadeGroup),
  placement: z
    .object({ origin: z.object({ x: mm, z: mm }), rotationDeg: z.number().finite() })
    .optional(),
});

export const projectSchema = z.object({
  id,
  name: z.string(),
  units: z.literal('mm'),
  metadata: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    appVersion: z.string(),
  }),
  materials: z.object({
    items: z.record(z.string(), material),
    assignment: z.record(z.string(), id),
  }),
  hardware: z.object({
    items: z.record(
      z.string(),
      z.object({
        id,
        kind: z.string(),
        name: z.string(),
        spec: z.record(z.string(), z.union([z.string(), z.number()])),
      }),
    ),
  }),
  furniture: z.array(furniture).min(1),
  room: z
    .object({
      walls: z.array(
        z.object({
          id,
          a: z.object({ x: mm, z: mm }),
          b: z.object({ x: mm, z: mm }),
          thickness: positiveMm,
          height: positiveMm,
        }),
      ),
      ceilingHeight: positiveMm,
    })
    .optional(),
  settings: z.object({
    defaultMaterialId: id,
    defaultEdge: edgeSpec,
    construction: z.object({
      verticalPriority: z.enum(['sides-through', 'horizontals-through', 'mixed']),
      topOverlaysSides: z.boolean(),
      bottomOverlaysSides: z.boolean(),
      jointType: z.enum(['confirmat', 'eccentric', 'dowel', 'eccentric+dowel']),
    }),
    tolerances: z.object({
      depthIncludesBackPanel: z.boolean(),
      depthIncludesFacade: z.boolean(),
      heightIncludesBase: z.boolean(),
    }),
    edgeSizing: z.object({ subtractFromPartSize: z.boolean() }),
  }),
});

export const projectDocumentSchema = z.object({
  schemaVersion: z.number().int().nonnegative(),
  project: projectSchema,
});

/** Разбирает только версию: она нужна до того, как содержимое станет понятным. */
export const versionProbeSchema = z.object({ schemaVersion: z.number().int().nonnegative() });
