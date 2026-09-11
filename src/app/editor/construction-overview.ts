import { contentKindOf } from '../../geometry/index.js';
import { cellName } from './cell-identity.js';
import type { Furniture, NodeId } from '../../domain/index.js';
import type { GeometryResult } from '../../geometry/index.js';

/**
 * Состав изделия и незавершённые места конструкции (PROMPT 64 §4, §6).
 *
 * ## Дефект, ради которого модуль появился
 *
 * `FR-10`: шаги 10 «Проверка» и 11 «Производство» открывали ОДИН И ТОТ
 * ЖЕ экран в одном и том же разделе. Замер на собранном приложении:
 * текст `main` без лестницы шагов — 1817 знаков у обоих, совпадает
 * посимвольно, 19 общих органов управления, ноль своих. Одиннадцать
 * шагов при этом обещали одиннадцать разных задач.
 *
 * Шаг 10 вернулся в конструктор и отвечает на вопрос конструктора:
 * **достроено ли изделие и что осталось**. На вопрос производства
 * «что изготавливать» отвечает шаг 11 — и только он.
 *
 * ## Незавершённость — не ошибка
 *
 * Пустое отделение в шкафу — нормальный выбор, а не дефект: открытая
 * ниша тоже мебель. Модуль НАЗЫВАЕТ такие места и не мешает идти
 * дальше. Слово «ошибка» здесь не употребляется ни разу — это
 * умышленно: ошибки расчёта живут в производстве и выглядят иначе.
 *
 * ## Ничего не считает заново
 *
 * Всё выводится из уже посчитанных `Furniture` и `GeometryResult`. Ни
 * одной производственной величины: деталировка, раскрой и фурнитура
 * остаются заботой производства (§18 — расчёты не меняются).
 *
 * ## Файл чистый
 *
 * Ни React, ни DOM. Проверяется обычным тестом.
 */

/** Незавершённое место конструкции: что это и где. */
export interface OpenSpot {
  readonly nodeId: NodeId;
  /** Имя отделения человеческими словами — то же, что в инспекторе. */
  readonly name: string;
}

export interface ConstructionOverview {
  readonly sections: number;
  readonly cells: number;
  readonly parts: number;
  /** Отделения, в которые ничего не положили. */
  readonly empty: readonly OpenSpot[];
  /** Отделения без фасада: открытые ниши. */
  readonly open: readonly OpenSpot[];
  /** Отделений с наполнением. */
  readonly filled: number;
  /** Фасадов на изделии. */
  readonly facades: number;
  /** Нечего дополнять: всё занято и всё закрыто. */
  readonly complete: boolean;
}

/**
 * Состав изделия и его незакрытые места.
 *
 * `empty` и `open` пересекаются намеренно: пустое отделение без фасада
 * попадает в оба списка, потому что это два разных решения — что
 * положить внутрь и чем закрыть снаружи.
 */
export function constructionOverview(
  furniture: Furniture | undefined,
  geometry: GeometryResult | undefined,
): ConstructionOverview | undefined {
  if (furniture === undefined || geometry === undefined) return undefined;

  const covered = new Set(
    furniture.facades
      .filter((group) => group.covers.kind === 'node')
      .map((group) => (group.covers as { readonly nodeId: NodeId }).nodeId),
  );

  const empty: OpenSpot[] = [];
  const open: OpenSpot[] = [];
  let filled = 0;

  for (const cell of geometry.cells) {
    const spot: OpenSpot = { nodeId: cell.nodeId, name: cellName(cell.nodeId, geometry) };
    if (contentKindOf(cell.fill) === 'empty') empty.push(spot);
    else filled += 1;
    if (!covered.has(cell.nodeId)) open.push(spot);
  }

  return {
    sections: geometry.sections.length,
    cells: geometry.cells.length,
    parts: geometry.parts.length,
    empty,
    open,
    filled,
    facades: furniture.facades.length,
    complete: empty.length === 0 && open.length === 0,
  };
}

/**
 * Что сказать человеку про незавершённые места.
 *
 * Тон утвердительный, а не укоризненный: это перечисление принятых
 * решений, а не список претензий. «Открытая ниша» — обычная мебель, и
 * фраза не должна звучать как «вы забыли».
 */
export function describeOverview(overview: ConstructionOverview): readonly string[] {
  const out: string[] = [];
  if (overview.empty.length > 0) {
    out.push(
      `${plural(overview.empty.length, 'отделение', 'отделения', 'отделений')} без наполнения — останутся открытыми нишами`,
    );
  }
  if (overview.open.length > 0) {
    out.push(
      `${plural(overview.open.length, 'отделение', 'отделения', 'отделений')} без фасада — останутся открытыми`,
    );
  }
  return out;
}

/** Русское склонение по числу: «3 отделения», а не «3 отделение». */
function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  const word =
    mod100 >= 11 && mod100 <= 14 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many;
  return `${String(count)} ${word}`;
}
