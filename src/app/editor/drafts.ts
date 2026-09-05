import { formatMm, isSplit } from '../../domain/index.js';
import type { Furniture, LeafNode, SectionNode } from '../../domain/index.js';

/**
 * Черновые значения панелей конструктора, выведенные из открытого проекта
 * (PROMPT 31 §5, §7).
 *
 * ## Зачем этот модуль существует
 *
 * Поля «Секций», «Ширины секций», «Строк», «Колонок» и «Полок в каждой
 * ячейке» — черновые: они не правят проект до нажатия «Применить»
 * (docs/INTERACTION_MODEL.md §4.4). До этого этапа они жили в `useState`
 * с константами `1 / '' / 1 / 1 / 0` и НИКОГДА не пересчитывались.
 *
 * Последствие было не косметическим. Приложение восстанавливает последний
 * сохранённый проект при открытии вкладки, и проект открывается из
 * библиотеки и из файла. Во всех трёх случаях на экране оказывался,
 * например, трёхсекционный шкаф, а поле показывало «Секций: 1» и кнопку
 * «Применить секций: 1». Одно нажатие — и структура схлопывалась до одной
 * секции. Пользователь при этом не ошибался: он нажимал кнопку, значение
 * которой видел на экране.
 *
 * ## Почему выведение, а не второе состояние
 *
 * Домен не хранит «число секций» отдельным числом — им является само
 * дерево (`docs/DATA_MODEL.md` §5). Значит и здесь ничего не хранится:
 * черновик ВЫВОДИТСЯ из дерева ровно тогда, когда меняется открытый
 * проект. Второго источника истины о структуре не заводится — иначе
 * вернулась бы та же рассинхронизация, только с другой стороны.
 *
 * ## Почему это отдельный модуль, а не код внутри App
 *
 * Это расчёт, а не разметка (§5: расчёты не живут в UI). Модуль чистый —
 * ни React, ни DOM — и потому проверяется обычным юнит-тестом, тогда как
 * та же логика внутри компонента проверялась бы только через браузер.
 */

/** Значения черновых полей конструктора. */
export interface EditorDrafts {
  /** Число секций верхнего уровня. Лист — одна секция. */
  readonly sections: number;
  /** Ширины секций строкой «300, 500, 400». Пусто — все секции равные. */
  readonly sectionWidths: string;
  readonly rows: number;
  readonly columns: number;
  /** Полок в ячейке — только если оно одинаково во ВСЕХ ячейках сетки. */
  readonly shelves: number;
}

/** Что показывает пустой проект: одна секция, сетка 1×1, полок нет. */
export const EMPTY_DRAFTS: EditorDrafts = {
  sections: 1,
  sectionWidths: '',
  rows: 1,
  columns: 1,
  shelves: 0,
};

/**
 * Число секций верхнего уровня.
 *
 * Секции — деление корня по оси X (`applySectionCount` строит именно его).
 * Всё остальное — лист или деление по Y — это одна секция, внутри которой
 * уже идёт сетка: ровно так же на это смотрит `SetSectionCount`.
 *
 * ## Неоднозначность и как она разрешена
 *
 * Деление корня по X даёт одно и то же дерево двумя путями: «4 секции»
 * (`SetSectionCount`) и «сетка 1 × 4» (`SetRoot`). Различить их постфактум
 * нельзя — в модели этого различия нет, и заводить его ради полей ввода
 * значило бы хранить намерение пользователя рядом с деревом, то есть
 * второй источник истины о структуре.
 *
 * Поэтому правило одно и явное: деление корня по X — это СЕКЦИИ, а
 * колонки живут уровнем ниже. Так его и читают обе команды, которые
 * правят этот уровень (`SetSectionCount` и `SetChildSize` из «Ширины
 * секций»); значит и поля показывают то, на что эти команды подействуют.
 */
function sectionsOf(root: SectionNode): number {
  return isSplit(root) && root.axis === 'x' ? root.children.length : 1;
}

/**
 * Ширины секций строкой в том же формате, который принимает поле ввода.
 *
 * Пустая строка возвращается в двух случаях: секций нет и все секции
 * растягиваемые. Это не «нули», а отсутствие ограничения — то самое
 * значение, которое `applySectionWidths` понимает как «равные секции».
 * Смешанный случай (часть секций фиксированная) выводится как есть:
 * растягиваемые дают пустое место между запятыми, и повторное
 * «Применить ширины» вернёт ровно ту же раскладку.
 */
function sectionWidthsOf(root: SectionNode): string {
  if (!isSplit(root) || root.axis !== 'x') return '';
  const values = root.children.map((child) =>
    child.size.mode === 'fixed' ? formatMm(child.size.value) : '',
  );
  return values.every((value) => value === '') ? '' : values.join(', ');
}

/** Секции верхнего уровня как список поддеревьев. Лист — одна секция. */
function sectionNodes(root: SectionNode): readonly SectionNode[] {
  return isSplit(root) && root.axis === 'x' ? root.children.map((child) => child.node) : [root];
}

/**
 * Сетка `rows × columns` внутри секции, если она там есть.
 *
 * Форма ровно та, которую строит `createUniformGrid`: внешнее деление по Y
 * — строки, внутри каждой строки деление по X — колонки. Всё, что в эту
 * форму не укладывается (неравное число колонок в строках, деление глубже
 * двух уровней), сеткой не является: тогда возвращается `undefined`, и
 * поля остаются на «1 × 1». Придумывать число строк для произвольного
 * дерева — значит показать пользователю величину, которой в модели нет.
 */
function gridOf(section: SectionNode): { readonly rows: number; readonly columns: number } | undefined {
  if (!isSplit(section)) return { rows: 1, columns: 1 };
  if (section.axis === 'x') {
    return section.children.every((child) => !isSplit(child.node))
      ? { rows: 1, columns: section.children.length }
      : undefined;
  }
  const rows = section.children.map((child) => child.node);
  const columns = rows.map((row) => (isSplit(row) ? (row.axis === 'x' ? row.children.length : 0) : 1));
  if (columns.some((count) => count === 0)) return undefined;
  const [first] = columns;
  if (first === undefined || columns.some((count) => count !== first)) return undefined;
  const cells = rows.flatMap((row) => (isSplit(row) ? row.children.map((child) => child.node) : [row]));
  return cells.every((cell) => !isSplit(cell)) ? { rows: rows.length, columns: first } : undefined;
}

/** Все листья поддерева — то есть ячейки. */
function leavesOf(node: SectionNode): readonly LeafNode[] {
  if (!isSplit(node)) return [node];
  return node.children.flatMap((child) => leavesOf(child.node));
}

/**
 * Полок в ячейке — одно число на ВСЕ ячейки изделия.
 *
 * Считается по всему дереву, а не по одной секции, потому что поле именно
 * так и применяется: «Применить сетку» ставит это число каждой ячейке
 * новой сетки. Если в разных ячейках полок поровну — число правдиво;
 * если нет, показывать любое из них значило бы соврать про остальные, и
 * поле остаётся на нуле.
 */
function shelvesOf(root: SectionNode): number | undefined {
  const counts = leavesOf(root).map((leaf) =>
    leaf.fill.kind === 'shelves' ? leaf.fill.shelves.length : 0,
  );
  const [first] = counts;
  if (first === undefined) return undefined;
  return counts.every((count) => count === first) ? first : undefined;
}

/**
 * Черновые значения, соответствующие открытому изделию.
 *
 * Изделия нет — значения пустого проекта: показать «Секций: 3» от
 * предыдущего проекта было бы той же ложью, от которой этот модуль и
 * заведён.
 */
export function draftsOf(furniture: Furniture | undefined): EditorDrafts {
  if (furniture === undefined) return EMPTY_DRAFTS;
  const root = furniture.root;
  const [firstSection] = sectionNodes(root);
  const grid = firstSection === undefined ? undefined : gridOf(firstSection);
  const shelves = shelvesOf(root);
  return {
    sections: sectionsOf(root),
    sectionWidths: sectionWidthsOf(root),
    rows: grid?.rows ?? EMPTY_DRAFTS.rows,
    columns: grid?.columns ?? EMPTY_DRAFTS.columns,
    shelves: shelves ?? EMPTY_DRAFTS.shelves,
  };
}
