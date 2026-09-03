import type {
  BackPanelMount,
  BaseSpec,
  Box3,
  CountertopSpec,
  EdgeSpec,
  MaterialId,
  OverhangSpec,
  OverhangTarget,
  PartRole,
  TopSectionSpec,
  Vec3,
} from '../../domain/index.js';
import { DEFAULT_EDGE, box3, roundMm, vec3 } from '../../domain/index.js';
import type { GeometryContext, GeometryStage } from '../context.js';
import { makePart, resolveEffectiveMaterial } from '../parts.js';

/**
 * Каркас: боковины, верх, низ, внутренний объём.
 *
 * Реализует три схемы стыка из docs/ARCHITECTURE.md §5.3. Какая из них
 * используется референсом — неизвестно (ASSUMPTION(T-CAR-01)), поэтому
 * поддерживаются все три и выбор остаётся параметром проекта. Когда тест
 * будет проведён, изменится значение по умолчанию, а не этот код.
 */

interface BackGeometry {
  /** Толщина задней стенки, 0 если её нет. */
  readonly thickness: number;
  /** Смещение передней плоскости корпуса от начала координат по Z. */
  readonly carcassZ0: number;
  /** Глубина корпусных деталей. */
  readonly carcassDepth: number;
  /** Передняя граница внутреннего объёма по Z. */
  readonly innerZ0: number;
}

/**
 * Как цоколь смещает корпус по Y (PROMPT 14 §10, §13).
 *
 * Симметрична `resolveBackGeometry`: там задняя стенка решает, где начинается
 * корпус по Z и сколько глубины ему остаётся, здесь цоколь решает то же по Y.
 * Единственный источник этого сдвига в проекте — корпус, наполнение, двери и
 * ящики получают его бесплатно, потому что все они выводятся из
 * `ctx.innerVolume`, а не из `H` напрямую.
 *
 * `heightIncludesBase` (`ASSUMPTION(T-CAR-05)`) — тот самый параметр, который
 * до PROMPT 14 существовал в модели и сериализации, но геометрией не читался:
 *   true  — H задаёт изделие целиком, корпусу остаётся H − plinthHeight;
 *   false — H задаёт только корпус, цоколь добавляется под ним сверх H.
 */
export function resolveBasePlacement(
  base: BaseSpec | undefined,
  height: number,
  heightIncludesBase: boolean,
): { plinthHeight: number; carcassY0: number; carcassHeight: number } {
  const layout = resolveVerticalLayout({ base, height, heightIncludesBase });
  return { plinthHeight: layout.plinthHeight, carcassY0: layout.carcassY0, carcassHeight: layout.carcassHeight };
}

/**
 * Вертикальный бюджет изделия целиком (PROMPT 15 §6) — единственное место,
 * где решается, какую полосу по Y занимает каждый конструктивный элемент.
 *
 * Источник истины — габарит `H`; высота ОСНОВНОГО корпуса производная:
 * ```
 * mainHeight = H − plinthHeight − countertopThickness − gap − topSectionHeight − ceilingGap
 * ```
 * Это не новое правило, а расширение уже введённого на PROMPT 14: там из
 * `H` так же вычиталась высота цоколя. Все элементы бюджета лежат один над
 * другим снизу вверх:
 * ```
 * 0 ──── цоколь ──── основной корпус ──── столешница ──── зазор ──── антресоль ──── зазор до потолка ──── H
 * ```
 * `heightIncludesBase = false` сохраняет прежний смысл (PROMPT 14 §23.1):
 * высота основного корпуса равна `H` целиком, а всё остальное добавляется
 * к габариту сверху и снизу. `ASSUMPTION(T-MOD-03)`.
 */
export interface VerticalLayout {
  readonly plinthHeight: number;
  /** Низ основного корпуса. */
  readonly carcassY0: number;
  readonly carcassHeight: number;
  /** Толщина столешницы, 0 если её нет. */
  readonly countertopThickness: number;
  /** Низ столешницы — сразу над основным корпусом. */
  readonly countertopY0: number;
  readonly topSectionHeight: number;
  readonly topSectionGap: number;
  /** Низ антресоли, `undefined` если её нет. */
  readonly topSectionY0: number | undefined;
  readonly ceilingGap: number;
  /** Верх изделия целиком, включая всё перечисленное. */
  readonly totalTop: number;
}

export interface VerticalLayoutInput {
  readonly base: BaseSpec | undefined;
  readonly height: number;
  readonly heightIncludesBase: boolean;
  readonly countertop?: CountertopSpec | undefined;
  readonly topSection?: TopSectionSpec | undefined;
  readonly ceilingGap?: number | undefined;
}

export function resolveVerticalLayout(input: VerticalLayoutInput): VerticalLayout {
  const H = roundMm(input.height);
  const { base } = input;

  const plinthHeight = base === undefined || base.kind === 'none' || !(base.height > 0) ? 0 : roundMm(base.height);
  const countertopThickness =
    input.countertop === undefined || !(input.countertop.thickness > 0) ? 0 : roundMm(input.countertop.thickness);
  const topSection = input.topSection !== undefined && input.topSection.height > 0 ? input.topSection : undefined;
  const topSectionHeight = topSection === undefined ? 0 : roundMm(topSection.height);
  const topSectionGap = topSection === undefined ? 0 : roundMm(Math.max(topSection.gap, 0));
  const ceilingGap = input.ceilingGap === undefined || input.ceilingGap < 0 ? 0 : roundMm(input.ceilingGap);

  // Всё, что делит габарит по вертикали с основным корпусом. При
  // `heightIncludesBase = false` габарит задаёт только основной корпус, и
  // остальные полосы к нему прибавляются, а не вычитаются из него.
  const consumed = roundMm(plinthHeight + countertopThickness + topSectionGap + topSectionHeight + ceilingGap);
  const carcassHeight = input.heightIncludesBase ? roundMm(H - consumed) : H;

  const carcassY0 = plinthHeight;
  const countertopY0 = roundMm(carcassY0 + carcassHeight);
  const topSectionY0 =
    topSection === undefined ? undefined : roundMm(countertopY0 + countertopThickness + topSectionGap);
  const totalTop = roundMm(
    (topSectionY0 ?? roundMm(countertopY0 + countertopThickness)) + topSectionHeight + ceilingGap,
  );

  return {
    plinthHeight,
    carcassY0,
    carcassHeight,
    countertopThickness,
    countertopY0,
    topSectionHeight,
    topSectionGap,
    topSectionY0,
    ceilingGap,
    totalTop,
  };
}

export function resolveBackGeometry(
  mount: BackPanelMount,
  depth: number,
  depthIncludesBackPanel: boolean,
): BackGeometry {
  if (mount.kind === 'none') {
    return { thickness: 0, carcassZ0: 0, carcassDepth: roundMm(depth), innerZ0: 0 };
  }

  const thickness = mount.thickness;

  if (mount.kind === 'overlay') {
    // Накладная стенка прибивается к заднему торцу корпуса и стоит ПЕРЕД ним
    // по оси Z: начало координат — задняя плоскость изделия целиком.
    const carcassDepth = depthIncludesBackPanel ? roundMm(depth - thickness) : roundMm(depth);
    return { thickness, carcassZ0: thickness, carcassDepth, innerZ0: thickness };
  }

  // Вкладная стенка находится внутри глубины корпуса.
  const innerOffset = mount.kind === 'inset-groove' ? mount.grooveOffsetFromRear + thickness : thickness;
  return {
    thickness,
    carcassZ0: 0,
    carcassDepth: roundMm(depth),
    innerZ0: roundMm(innerOffset),
  };
}

/** Идут ли горизонтали на всю ширину изделия при данной схеме. */
function horizontalsSpanFullWidth(ctx: GeometryContext): { top: boolean; bottom: boolean } {
  const { scheme } = ctx.input;
  switch (scheme.verticalPriority) {
    case 'horizontals-through':
      return { top: true, bottom: true };
    case 'sides-through':
      return { top: false, bottom: false };
    case 'mixed':
      return { top: scheme.topOverlaysSides, bottom: scheme.bottomOverlaysSides };
  }
}

/**
 * Одна оболочка корпуса: две боковины плюс верх и низ по схеме стыка.
 *
 * Вынесена в отдельную функцию на PROMPT 15: антресоль (§5) — это ВТОРАЯ
 * такая оболочка над основной, и строить её копией тех же формул значило бы
 * завести вторую геометрию корпуса. Формулы не изменились ни на одну —
 * изменилось только то, что теперь у них один экземпляр, а не два.
 */
interface ShellInput {
  /** Полоса по Y, которую занимает оболочка. */
  readonly y0: number;
  readonly height: number;
  /** Полоса по Z (из `resolveBackGeometry`). */
  readonly z0: number;
  readonly depth: number;
  readonly width: number;
  readonly thickness: number;
  readonly hasTop: boolean;
  readonly hasBottom: boolean;
  /** Свес горизонталей за габарит; отсутствует — свеса нет. */
  readonly overhang?: OverhangSpec | undefined;
  /** Материал оболочки; не задан — материал роли. */
  readonly materialId?: MaterialId | undefined;
  /** Суффикс подписи детали: у антресоли — « (антресоль)». */
  readonly labelSuffix: string;
  /** Смещение индексов деталей, чтобы id основного корпуса и антресоли не совпали. */
  readonly indexOffset: number;
}

interface ShellResult {
  /** Внутренний объём оболочки. */
  readonly inner: Box3;
  readonly ok: boolean;
}

/** Применим ли свес к этой цели (PROMPT 15 §4): применимость всегда явная. */
function overhangFor(overhang: OverhangSpec | undefined, target: OverhangTarget): OverhangSpec | undefined {
  if (overhang === undefined || !overhang.appliesTo.includes(target)) return undefined;
  return overhang;
}

function buildShell(ctx: GeometryContext, shell: ShellInput): ShellResult {
  const { furniture, edgeSizing, materials } = ctx.input;
  const { width: W, thickness: T, depth: Dc, z0, y0, height: Hc, hasTop, hasBottom } = shell;

  const full = horizontalsSpanFullWidth(ctx);
  const topFull = full.top && hasTop;
  const bottomFull = full.bottom && hasBottom;

  const sideY0 = roundMm(y0 + (bottomFull ? T : 0));
  const sideY1 = roundMm(y0 + (topFull ? Hc - T : Hc));
  const sideHeight = roundMm(sideY1 - sideY0);

  const material = (role: PartRole): { materialId: MaterialId; edge: EdgeSpec } => {
    const resolved = resolveEffectiveMaterial({
      materials,
      role,
      explicitMaterialId: shell.materialId,
      thicknessOverride: T,
      corpusThickness: T,
    });
    if (resolved.roleNotAssigned) {
      ctx.report('MATERIAL_NOT_ASSIGNED', 'warning', `Материал для роли «${role}» не назначен, взят первый из библиотеки.`);
    }
    if (resolved.danglingMaterialId) {
      ctx.report('MATERIAL_REFERENCE_BROKEN', 'error', `Материал оболочки корпуса не найден в библиотеке${shell.labelSuffix}.`);
    }
    return { materialId: resolved.materialId, edge: DEFAULT_EDGE };
  };

  // Оболочка обязана вмещать свои же горизонтали: при `Hc` меньше их
  // суммарной толщины крышка и дно налезли бы друг на друга и вышли за
  // полосу оболочки. Для основного корпуса это отсекает `normalize`, а вот
  // антресоль высотой в пару миллиметров проходила бы мимо всех проверок —
  // найдено property-тестом (`modifiers-properties.test.ts`).
  const horizontalsThickness = roundMm((hasTop ? T : 0) + (hasBottom ? T : 0));
  if (sideHeight <= 0 || Hc < horizontalsThickness) {
    ctx.report(
      'SHELL_HEIGHT_TOO_SMALL',
      'error',
      `Высота оболочки${shell.labelSuffix} (${String(Hc)} мм) меньше суммарной толщины её крышки и дна.`,
    );
    return { inner: box3(vec3(0, y0, z0), vec3(0, 0, 0)), ok: false };
  }

  // ── Боковины ────────────────────────────────────────────────────────────
  const sideSize: Vec3 = vec3(T, sideHeight, Dc);
  const sideMat = material('side');
  ctx.addPart(
    makePart({
      furnitureId: furniture.id,
      role: 'side',
      label: `Боковина левая${shell.labelSuffix}`,
      index: shell.indexOffset,
      position: vec3(0, sideY0, z0),
      size: sideSize,
      orientation: 'vertical-yz',
      materialId: sideMat.materialId,
      edge: sideMat.edge,
      edgeSizing,
    }),
  );
  ctx.addPart(
    makePart({
      furnitureId: furniture.id,
      role: 'side',
      label: `Боковина правая${shell.labelSuffix}`,
      index: shell.indexOffset + 1,
      position: vec3(roundMm(W - T), sideY0, z0),
      size: sideSize,
      orientation: 'vertical-yz',
      materialId: sideMat.materialId,
      edge: sideMat.edge,
      edgeSizing,
    }),
  );

  // ── Горизонтали ─────────────────────────────────────────────────────────
  const horizontal = (role: 'top' | 'bottom', label: string, spansFullWidth: boolean, y: number): void => {
    // Свес (PROMPT 15 §4) расширяет ТОЛЬКО ту горизонталь, которая названа
    // в `appliesTo`, и только наружу от габарита корпуса. Боковины он не
    // трогает никогда: свес — это выступ пласти за корпус, а не другой корпус.
    const o = overhangFor(shell.overhang, role);
    const front = o === undefined ? 0 : roundMm(o.front);
    const back = o === undefined ? 0 : roundMm(o.back);

    // Боковой свес физически возможен ТОЛЬКО у сквозной горизонтали: она
    // лежит ПОВЕРХ боковин и может выступать за них. Вкладная горизонталь
    // (`sides-through`) стоит МЕЖДУ боковинами на всю их высоту, и её
    // расширение вбок вошло бы прямо в тело боковины — это не свес, а
    // пересечение деталей. Найдено property-тестом и сценарием
    // «BackWall + Plinth + Overhang» (`docs/GEOMETRY_RULES.md` §26.2).
    const lateralRequested = o !== undefined && (o.left > 0 || o.right > 0);
    const lateralAllowed = spansFullWidth;
    const left = o === undefined || !lateralAllowed ? 0 : roundMm(o.left);
    const right = o === undefined || !lateralAllowed ? 0 : roundMm(o.right);

    if (lateralRequested && !lateralAllowed) {
      ctx.report(
        'OVERHANG_INCOMPATIBLE_WITH_SCHEME',
        'warning',
        `Боковой свес детали «${label}» не применён: при этой схеме стыка она стоит между боковинами, а не поверх них.`,
        { path: 'carcass.overhang' },
      );
    }

    const x0 = roundMm((spansFullWidth ? 0 : T) - left);
    const w = roundMm((spansFullWidth ? W : roundMm(W - 2 * T)) + left + right);
    const partZ0 = roundMm(z0 - back);
    const partDepth = roundMm(Dc + back + front);

    if (w <= 0 || partDepth <= 0) {
      ctx.report('HORIZONTAL_WIDTH_NOT_POSITIVE', 'error', `Деталь «${label}» имеет нулевую ширину.`);
      return;
    }
    if (x0 < 0 || partZ0 < 0) {
      ctx.report(
        'OVERHANG_OUT_OF_BOUNDS',
        'error',
        `Свес детали «${label}» выводит её за начало координат: уменьшите свес слева или сзади.`,
        { path: 'carcass.overhang' },
      );
      return;
    }

    const mat = material(role);
    ctx.addPart(
      makePart({
        furnitureId: furniture.id,
        role,
        label,
        index: shell.indexOffset,
        position: vec3(x0, y, partZ0),
        size: vec3(w, T, partDepth),
        orientation: 'horizontal-xz',
        materialId: mat.materialId,
        edge: mat.edge,
        edgeSizing,
      }),
    );
  };

  if (hasBottom) horizontal('bottom', `Дно${shell.labelSuffix}`, bottomFull, y0);
  if (hasTop) horizontal('top', `Крышка${shell.labelSuffix}`, topFull, roundMm(y0 + Hc - T));

  const innerY0 = roundMm(y0 + (hasBottom ? T : 0));
  const innerY1 = roundMm(y0 + (hasTop ? Hc - T : Hc));
  return {
    inner: box3(vec3(T, innerY0, z0), vec3(roundMm(W - 2 * T), roundMm(innerY1 - innerY0), Dc)),
    ok: true,
  };
}

export const carcassStage: GeometryStage = {
  name: 'carcass',
  run(ctx: GeometryContext): void {
    const { furniture, tolerances } = ctx.input;
    // Нормализуем входные габариты ОДИН раз и переиспользуем нормализованные
    // значения во всех формулах ниже. Раньше T бралась «сырой» и округлялась
    // отдельно на каждом месте использования (в позиции W−T и в размере
    // детали T) — при T, не лежащей на сетке 0.1 мм (например, T = 8.25),
    // два независимых округления могли разойтись в одну сторону и правая
    // боковина оказывалась на 0.1 мм за пределами заявленной ширины.
    // Найдено property-тестом, см. docs/TESTING_STRATEGY.md §4 и
    // tests/unit/geometry/properties.test.ts.
    const W = roundMm(furniture.dimensions.width);
    const H = roundMm(furniture.dimensions.height);
    const D = roundMm(furniture.dimensions.depth);
    const T = roundMm(furniture.dimensions.panelThickness);
    const { hasTop, hasBottom, back, base, overhang, topSection, countertop, ceilingGap } = furniture.carcass;

    const backGeom = resolveBackGeometry(back.mount, D, tolerances.depthIncludesBackPanel);
    const Dc = backGeom.carcassDepth;
    const z0 = backGeom.carcassZ0;

    // Вертикальный бюджет считает ОДНА функция (PROMPT 15 §6): цоколь,
    // основной корпус, столешница, зазор, антресоль и зазор до потолка
    // делят габарит H между собой, и никто из них не считает свою полосу сам.
    const layout = resolveVerticalLayout({
      base,
      height: H,
      heightIncludesBase: tolerances.heightIncludesBase,
      countertop,
      topSection,
      ceilingGap,
    });
    const y0 = layout.carcassY0;
    const Hc = layout.carcassHeight;

    if (Dc <= 0) {
      ctx.report(
        'CARCASS_DEPTH_NOT_POSITIVE',
        'error',
        'Глубина корпуса после вычета задней стенки не положительна.',
        { path: 'dimensions.depth' },
      );
      return;
    }

    if (Hc <= 0) {
      ctx.report(
        'CARCASS_HEIGHT_NOT_POSITIVE',
        'error',
        'Высота корпуса не положительна: цоколь, столешница, антресоль и зазор до потолка в сумме не оставляют места основному корпусу.',
        { path: 'dimensions.height' },
      );
      return;
    }

    // ── Основная оболочка ─────────────────────────────────────────────────
    const main = buildShell(ctx, {
      y0,
      height: Hc,
      z0,
      depth: Dc,
      width: W,
      thickness: T,
      hasTop,
      hasBottom,
      overhang,
      labelSuffix: '',
      indexOffset: 0,
    });

    // ── Антресоль: та же оболочка, другая полоса по Y (PROMPT 15 §5) ──────
    if (topSection !== undefined && layout.topSectionY0 !== undefined && layout.topSectionHeight > 0) {
      buildShell(ctx, {
        y0: layout.topSectionY0,
        height: layout.topSectionHeight,
        z0,
        depth: Dc,
        width: W,
        thickness: T,
        hasTop: topSection.hasTop,
        hasBottom: topSection.hasBottom,
        // Свес корпуса на антресоль не переносится: её собственный свес
        // референсом не подтверждён (T-MOD-01), а молча наследовать чужой
        // значило бы придумать правило.
        materialId: topSection.materialId,
        labelSuffix: ' (антресоль)',
        indexOffset: 100,
      });

      // Внутреннее пространство антресоли деревом секций пока не наполняется:
      // `Furniture.root` описывает ОДНО внутреннее пространство, а второе
      // дерево — отдельное решение уровня модели (T-MOD-02). Явный статус
      // вместо тихого пропуска — тот же приём, что у короба ящика.
      ctx.report(
        'TOP_SECTION_CONTENT_NOT_IMPLEMENTED',
        'info',
        'Внутреннее наполнение антресоли пока не строится: у изделия одно дерево секций, второе — отдельное решение модели.',
        { path: 'carcass.topSection' },
      );
    }

    // ── Габарит и внутренний объём ────────────────────────────────────────
    // Габаритная высота — верх ИЗДЕЛИЯ целиком (`layout.totalTop`), включая
    // столешницу, антресоль и зазор до потолка: при `heightIncludesBase =
    // false` они добавляются сверх заявленной высоты, и bounding box обязан
    // это показать.
    ctx.bounds = box3(vec3(0, 0, 0), vec3(W, layout.totalTop, roundMm(z0 + Dc)));

    // Конструктивная сводка для debug-схемы (PROMPT 15 §16): те же числа,
    // что уже посчитал вертикальный бюджет, плюс режим установки. Ничего
    // не пересчитывается — только публикуется.
    ctx.structure = {
      plinthHeight: layout.plinthHeight,
      carcassY0: layout.carcassY0,
      carcassHeight: layout.carcassHeight,
      countertopThickness: layout.countertopThickness,
      topSectionHeight: layout.topSectionHeight,
      topSectionGap: layout.topSectionGap,
      ceilingGap: layout.ceilingGap,
      totalTop: layout.totalTop,
      wallMount: furniture.carcass.wallMount?.mode ?? 'floor-standing',
    };

    // Внутренний объём — по-прежнему ОСНОВНОЙ корпус: именно в нём живут
    // секции, ячейки, полки, двери и ящики.
    const innerZ0 = roundMm(z0 + (backGeom.innerZ0 - z0 > 0 ? backGeom.innerZ0 - z0 : 0));
    const innerDepth = roundMm(z0 + Dc - innerZ0);
    ctx.innerVolume = box3(
      vec3(main.inner.min.x, main.inner.min.y, innerZ0),
      vec3(main.inner.size.x, main.inner.size.y, innerDepth),
    );

    if (main.inner.size.x <= 0 || main.inner.size.y <= 0 || innerDepth <= 0) {
      ctx.report(
        'INNER_VOLUME_EMPTY',
        'error',
        'Внутреннего пространства не остаётся: проверьте габариты и толщину материала.',
      );
    }
  },
};
