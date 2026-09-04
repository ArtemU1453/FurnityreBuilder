import type { Material, MaterialId, MaterialKind, MaterialLibrary } from '../domain/index.js';
import { FALLBACK_MATERIAL } from './types.js';
import type { SceneMaterial } from './types.js';

/**
 * Материал детали → визуальный материал (PROMPT 23 §12).
 *
 * ## Второго реестра материалов не заводится
 *
 * `MaterialLibrary` существует с PROMPT 13 и остаётся единственным
 * источником: имя, вид, толщина, цвет, текстура и формат листа живут
 * там. Здесь только ПОКАЗ — четыре числа, которые нужны шейдеру и не
 * нужны никому больше.
 *
 * ## Откуда берутся roughness, metallic и прозрачность
 *
 * Их нет в `Material` — и это не упущение: производству они не нужны, а
 * пользователь задаёт материал сам, без брендового каталога
 * (`docs/BRAND_INDEPENDENCE_AUDIT.md` §4.5). Поэтому они выводятся из
 * `Material.kind` — единственного поля, которое о внешнем виде вообще
 * что-то говорит.
 *
 * Это решение ОТРИСОВКИ, а не производственное правило, и потому не
 * требует подтверждения референсом: ошибиться здесь можно только в том,
 * насколько красиво выглядит стекло, а не в том, какого размера деталь.
 * Ровно поэтому таблица ниже намеренно скучная — читаемость и различимость
 * важнее похожести (§29).
 */

interface Appearance {
  readonly roughness: number;
  readonly metallic: number;
  readonly opacity: number;
}

/**
 * Внешний вид по виду материала.
 *
 * Плитные материалы различаются шероховатостью совсем немного — ровно
 * настолько, чтобы ЛДСП и МДФ не выглядели одним и тем же пластиком.
 * Прозрачность есть только у стекла: зеркало непрозрачно, оно отражает.
 */
const APPEARANCE: Readonly<Record<MaterialKind, Appearance>> = {
  chipboard: { roughness: 0.86, metallic: 0, opacity: 1 },
  mdf: { roughness: 0.78, metallic: 0, opacity: 1 },
  plywood: { roughness: 0.82, metallic: 0, opacity: 1 },
  hardboard: { roughness: 0.9, metallic: 0, opacity: 1 },
  solid: { roughness: 0.74, metallic: 0, opacity: 1 },
  // Стекло: прозрачность 0.28 — достаточно, чтобы увидеть, что за дверью,
  // и достаточно, чтобы дверь читалась как существующая деталь.
  glass: { roughness: 0.08, metallic: 0, opacity: 0.28 },
  // Зеркало непрозрачно и почти зеркально: metallic отвечает за то, что
  // блик у него белый, а не окрашенный в цвет материала.
  mirror: { roughness: 0.05, metallic: 0.9, opacity: 1 },
  other: { roughness: 0.85, metallic: 0, opacity: 1 },
};

/** `#rgb`/`#rrggbb` — единственный формат, который задаёт `Material.displayColor`. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeColor(color: string): string {
  const value = color.trim();
  if (!HEX.test(value)) return FALLBACK_MATERIAL.color;
  if (value.length === 4) {
    const [, r, g, b] = value;
    return `#${r ?? ''}${r ?? ''}${g ?? ''}${g ?? ''}${b ?? ''}${b ?? ''}`.toLowerCase();
  }
  return value.toLowerCase();
}

/** Визуальный материал одного материала библиотеки. */
export function toSceneMaterial(material: Material): SceneMaterial {
  const appearance = APPEARANCE[material.kind];
  return {
    materialId: material.id,
    color: normalizeColor(material.displayColor),
    roughness: appearance.roughness,
    metallic: appearance.metallic,
    opacity: appearance.opacity,
  };
}

/**
 * Визуальный материал по идентификатору.
 *
 * Битая ссылка НЕ откатывается тихо на «материал по роли»: приоритет
 * материалов (override детали → материал роли → материал по умолчанию)
 * разрешён геометрическим движком ДО того, как деталь попадает сюда, и
 * `Part.materialId` уже является окончательным ответом
 * (`resolveEffectiveMaterial`, `docs/GEOMETRY_RULES.md`, раздел
 * «ЭФФЕКТИВНАЯ ТОЛЩИНА»). Повторять эту иерархию в рендерере значило бы
 * завести второй, расходящийся ответ на тот же вопрос (§13).
 *
 * Поэтому единственный случай, который здесь остаётся, — материала нет в
 * библиотеке вовсе. Тогда деталь рисуется нейтрально-серой: скрывать её
 * нельзя (пользователь потеряет деталь из виду), а придумывать ей цвет
 * чужого материала — тем более.
 */
export function sceneMaterialOf(materials: MaterialLibrary, materialId: MaterialId): SceneMaterial {
  const material = materials.items[materialId];
  return material === undefined ? { ...FALLBACK_MATERIAL, materialId } : toSceneMaterial(material);
}

/**
 * Все визуальные материалы библиотеки, по идентификатору.
 *
 * Рендереру нужен именно словарь: цвет и прозрачность загружаются в
 * шейдер один раз на материал, а не на каждый объект (§31).
 */
export function buildSceneMaterials(materials: MaterialLibrary): ReadonlyMap<MaterialId, SceneMaterial> {
  const result = new Map<MaterialId, SceneMaterial>();
  for (const material of Object.values(materials.items)) {
    result.set(material.id, toSceneMaterial(material));
  }
  return result;
}
