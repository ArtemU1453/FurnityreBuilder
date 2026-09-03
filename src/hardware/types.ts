import type {
  Furniture,
  HardwareId,
  HardwareKind,
  HardwareLibrary,
  HardwareUnit,
  Issue,
  NodeId,
  PartId,
} from '../domain/index.js';
import type { GeometryResult } from '../geometry/index.js';

/**
 * Расчёт фурнитуры (PROMPT 16).
 *
 * ## Фурнитура — производная, а не второй источник истины
 *
 * Ни одно количество не хранится в модели: `door.hingeCount` в проекте нет
 * и не будет. Всё считается из уже построенной геометрии и конфигурации
 * (§2), поэтому изменение габарита, числа секций или наполнения ячейки
 * пересчитывает спецификацию автоматически — тем же способом, каким это
 * уже работает для деталей.
 *
 * ## Что здесь НЕ заводится
 *
 * Реестр фурнитуры уже существует: `HardwareLibrary` +
 * `HardwareDefinition` (`src/domain/hardware/types.ts`, с PROMPT 1). Второй
 * реестр рядом означал бы два справочника одного и того же — тот же довод,
 * которым PROMPT 13 отклонил вторую систему материалов. Здесь появляется
 * только ПРОИЗВОДНАЯ часть: позиция с количеством, её источник и правило,
 * которое её породило.
 */

/**
 * Статус правила (PROMPT 16 §27). Прямо влияет на поведение движка:
 * правило со статусом `needs-confirmation` НЕ выдаёт количество, а
 * сообщает, чего не хватает. Придумать порог и выдать его за расчёт —
 * ровно то, что задание запрещает.
 */
export type HardwareRuleStatus = 'confirmed' | 'implemented' | 'ambiguous' | 'needs-confirmation';

/**
 * ПРОИЗВОДНАЯ позиция фурнитуры: сколько и почему.
 *
 * Имя `HardwareItem` освобождено под неё на PROMPT 16 — до этого так
 * назывался справочник без количества, теперь он `HardwareDefinition`.
 */
export interface HardwareItem {
  /** Стабильный id: выводится из правила и источника, не из счётчика (§21). */
  readonly id: string;
  readonly definitionId: HardwareId;
  readonly kind: HardwareKind;
  readonly unit: HardwareUnit;
  /** Целое неотрицательное число (§17). */
  readonly quantity: number;
  /** Деталь-источник, если позиция порождена деталью. */
  readonly sourcePartId?: PartId;
  /** Узел-источник: ячейка, полка, ящик, створка (§4). */
  readonly sourceNodeId?: NodeId;
  /** Правило, породившее позицию — для трассируемости (§5). */
  readonly ruleId: string;
  /** Почему позиция появилась. Формируется системой, не пользователем (§4). */
  readonly reason: string;
}

/** Агрегированная строка спецификации: одинаковые позиции сложены (§16). */
export interface HardwareBomLine {
  readonly definitionId: HardwareId;
  readonly kind: HardwareKind;
  readonly name: string;
  readonly unit: HardwareUnit;
  readonly quantity: number;
  /** Все позиции, сложившиеся в эту строку: количество прослеживается до источника. */
  readonly sources: readonly HardwareItem[];
}

/**
 * Итог расчёта (§16).
 *
 * `warnings` — не косметика: именно туда попадают правила, которые
 * применимы, но не могут дать количество без подтверждения референсом.
 * Пустой BOM с внятным списком «чего не хватает» честнее, чем полный BOM
 * из выдуманных чисел.
 */
export interface HardwareBOM {
  readonly items: readonly HardwareItem[];
  readonly lines: readonly HardwareBomLine[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/** Вход правила: нормализованная модель плюс уже посчитанная геометрия (§14). */
export interface HardwareRuleContext {
  readonly furniture: Furniture;
  readonly geometry: GeometryResult;
  readonly library: HardwareLibrary;
}

/** Что правило вернуло: позиции и/или объяснение, почему их нет. */
export interface HardwareRuleResult {
  readonly items: readonly HardwareItem[];
  readonly warnings: readonly Issue[];
  readonly errors: readonly Issue[];
}

/**
 * Правило расчёта. Единый интерфейс для всех видов фурнитуры (§14, §29:
 * «не создавать отдельную систему фурнитуры для каждого типа Content»).
 *
 * `status` объявляется самим правилом и попадает в документацию
 * (`docs/HARDWARE_RULES.md`), а не подразумевается.
 */
export interface HardwareRule {
  readonly id: string;
  readonly title: string;
  readonly status: HardwareRuleStatus;
  /** Идентификатор неизвестного из `docs/UNKNOWNS.json`, если статус его требует. */
  readonly unknownId?: string;
  run(ctx: HardwareRuleContext): HardwareRuleResult;
}

export const EMPTY_RULE_RESULT: HardwareRuleResult = { items: [], warnings: [], errors: [] };

/**
 * Стабильный id позиции (§21): правило + источник, без порядковых номеров.
 *
 * Из-за этого позиция остаётся той же при изменении количества и исчезает
 * вместе со своим источником, а не «сдвигается» на соседнюю, как было бы
 * с индексом в массиве — та же политика идентичности, что у `Part`
 * (`docs/DATA_MODEL.md` §5.7).
 */
export function buildHardwareItemId(ruleId: string, source: string, definitionId: HardwareId): string {
  return `hw:${ruleId}/${source}/${definitionId}`;
}
