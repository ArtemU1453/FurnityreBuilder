import type { Issue } from '../../domain/index.js';
import type { Screen } from '../shell/index.js';
import type { Tone } from '../../design-system/index.js';

/**
 * Пошаговый сценарий конструктора (PROMPT 27 §3, §27).
 *
 * ## Что здесь есть и чего нет
 *
 * Здесь — ПОРЯДОК. Ни одной доменной величины, ни одной команды, ни
 * одной копии мебели: шаг знает только своё имя, свой экран и то, какие
 * проблемы к нему относятся. Всё, что шаг делает с проектом, делают уже
 * существующие команды (`src/state/commands.ts`, 44 штуки) и уже
 * существующие движки.
 *
 * Аудит PROMPT 27 показал, что органов управления не хватало ровно
 * ноль: панели «Габариты», «Сетка», «Корпус», «Модификаторы», «Двери»,
 * «Ящики», «Материалы» покрывали все одиннадцать этапов. Не хватало
 * порядка: семь панелей лежали стопкой в боковой колонке, и человек,
 * открывший конструктор впервые, видел их все сразу — без указания, с
 * чего начать и что будет дальше.
 *
 * ## Файл чистый
 *
 * Ни React, ни DOM. Это правило, а не оформление: порядок шагов и
 * разбор проблем по шагам проверяются обычным тестом, а не кликами.
 * Тот же приём, что у `editor/selection.ts` и `editor/resize.ts`
 * (`docs/ARCHITECTURE.md`).
 */

export type StepId =
  | 'dimensions'
  | 'carcass'
  | 'sections'
  | 'cells'
  | 'shelves'
  | 'fill'
  | 'facades'
  | 'materials'
  | 'construction'
  | 'validation'
  | 'production';

export interface WorkflowStep {
  readonly id: StepId;
  /** Номер для человека: «Шаг 3 из 11». */
  readonly index: number;
  readonly title: string;
  /** Что делают на этом шаге — одной строкой. */
  readonly hint: string;
  /** Раздел приложения, в котором живёт шаг. */
  readonly screen: Screen;
}

/**
 * Порядок повторяет порядок работы, а не порядок реализации.
 *
 * Сначала габарит — он определяет всё остальное; потом корпус, потом
 * деление на секции и ячейки, потом то, что в них стоит, потом то, что
 * их закрывает, потом материалы и конструктивные подробности. Проверка
 * и производство — в конце, потому что до них нечего проверять.
 */
export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  {
    id: 'dimensions',
    index: 1,
    title: 'Размеры',
    hint: 'Ширина, высота, глубина и толщина плиты.',
    screen: 'editor',
  },
  {
    id: 'carcass',
    index: 2,
    title: 'Корпус',
    hint: 'Задняя стенка и цоколь: из чего собран короб.',
    screen: 'editor',
  },
  {
    id: 'sections',
    index: 3,
    title: 'Секции',
    hint: 'Вертикальное деление корпуса перегородками.',
    screen: 'editor',
  },
  {
    id: 'cells',
    index: 4,
    title: 'Ячейки',
    hint: 'Ряды и колонки внутри секции. Ячейка — пространство, а не деталь.',
    screen: 'editor',
  },
  {
    id: 'shelves',
    index: 5,
    title: 'Полки',
    hint: 'Физические полки в выбранной ячейке.',
    screen: 'editor',
  },
  {
    id: 'fill',
    index: 6,
    title: 'Наполнение',
    hint: 'Что стоит внутри ячейки: полки, ящики, штанга.',
    screen: 'editor',
  },
  {
    id: 'facades',
    index: 7,
    title: 'Фасады',
    hint: 'Что закрывает ячейку снаружи: двери и фасады ящиков.',
    screen: 'editor',
  },
  {
    id: 'materials',
    index: 8,
    title: 'Материалы',
    hint: 'Плита и кромка для корпуса, полок и фасадов.',
    screen: 'editor',
  },
  {
    id: 'construction',
    index: 9,
    title: 'Конструкция',
    hint: 'Свесы, столешница, антресоль, крепление, фальшпанели.',
    screen: 'editor',
  },
  {
    id: 'validation',
    index: 10,
    title: 'Проверка',
    hint: 'Готовность к производству по разделам.',
    screen: 'production',
  },
  {
    id: 'production',
    index: 11,
    title: 'Производство',
    hint: 'Деталировка, фурнитура, присадка, раскрой и документы.',
    screen: 'production',
  },
];

export const STEP_BY_ID: Readonly<Record<StepId, WorkflowStep>> = Object.fromEntries(
  WORKFLOW_STEPS.map((step) => [step.id, step]),
) as Record<StepId, WorkflowStep>;

export const FIRST_STEP: StepId = 'dimensions';

/** Следующий и предыдущий шаг. `undefined` на краях — переходить некуда. */
export function nextStep(id: StepId): StepId | undefined {
  return WORKFLOW_STEPS[STEP_BY_ID[id].index]?.id;
}

export function previousStep(id: StepId): StepId | undefined {
  return WORKFLOW_STEPS[STEP_BY_ID[id].index - 2]?.id;
}

/**
 * К какому шагу относится проблема (PROMPT 27 §24).
 *
 * Разбор идёт по УЖЕ СУЩЕСТВУЮЩИМ полям диагностики: машинному коду и
 * пути к полю модели (`Issue.target.path`). Ни то, ни другое не заведено
 * ради этого файла — оба существуют с PROMPT 2 и заполняются движком и
 * валидацией. Заводить в `Issue` поле «шаг» значило бы объяснять домену
 * устройство интерфейса.
 *
 * Путь важнее кода: он точнее. Код — запасной разбор для диагностики
 * движка, у которой пути может не быть.
 */
export function stepOfIssue(issue: Issue): StepId | undefined {
  const path = issue.target?.path;
  if (path !== undefined) {
    const byPath = stepOfPath(path);
    if (byPath !== undefined) return byPath;
  }
  return stepOfCode(issue.code);
}

function stepOfPath(path: string): StepId | undefined {
  if (path.startsWith('dimensions')) return 'dimensions';
  if (path.startsWith('carcass.back')) return 'carcass';
  if (path.startsWith('carcass.base')) return 'carcass';
  if (path.startsWith('carcass.')) return 'construction';
  if (path.startsWith('materials') || path.startsWith('settings.defaultMaterialId'))
    return 'materials';
  if (path.startsWith('facades')) return 'facades';
  if (path.startsWith('root')) return 'sections';
  return undefined;
}

function stepOfCode(code: string): StepId | undefined {
  // Порядок проверок значим: более узкие префиксы идут раньше.
  if (code.startsWith('DIMENSION') || code.startsWith('CARCASS_') || code.startsWith('SHELL_')) {
    return 'dimensions';
  }
  if (code.startsWith('BACK_WALL') || code.startsWith('PLINTH')) return 'carcass';
  if (code.startsWith('SECTION') || code.startsWith('SPLIT') || code.startsWith('HORIZONTAL')) {
    return 'sections';
  }
  if (code.startsWith('CELL')) return 'cells';
  if (code.startsWith('SHELF')) return 'shelves';
  if (code.startsWith('CONTENT') || code.startsWith('ROD')) return 'fill';
  if (code.startsWith('DOOR') || code.startsWith('DRAWER') || code.startsWith('OPENING')) {
    return 'facades';
  }
  if (code.startsWith('MATERIAL') || code.startsWith('EDGE') || code.startsWith('GLASS')) {
    return 'materials';
  }
  if (
    code.startsWith('COUNTERTOP') ||
    code.startsWith('OVERHANG') ||
    code.startsWith('FALSE_PANEL') ||
    code.startsWith('TOP_SECTION') ||
    code.startsWith('WIDTH_BELOW') ||
    code.startsWith('HEIGHT_BELOW')
  ) {
    return 'construction';
  }
  // Ошибки самой деталировки (PART_*, INNER_VOLUME_*) не принадлежат ни
  // одному шагу настройки: их источник — расчёт целиком.
  return undefined;
}

/**
 * Состояние шага (PROMPT 27 §27).
 *
 * ## Почему нет состояния «завершён»
 *
 * У каждого шага есть осмысленные значения по умолчанию: `createProject`
 * возвращает проект, который считается и изготавливается. Поэтому
 * «завершённость» шага нельзя вывести из данных — вывести можно только
 * «здесь была ошибка» и «сюда заходили». Рисовать галочку «готово» там,
 * где критерия готовности не существует, значит показывать
 * несуществующий факт; §29 прямо запрещает выдуманный процент, и
 * выдуманная галочка ничем не лучше.
 *
 * Поэтому состояний пять и все они проверяемы:
 *
 * * `error`   — к шагу относится ошибка;
 * * `warning` — предупреждение или неподтверждённое правило;
 * * `current` — шаг открыт сейчас;
 * * `visited` — на шаге были и проблем на нём нет;
 * * `pending` — ещё не открывали.
 */
export type StepState = 'error' | 'warning' | 'current' | 'visited' | 'pending';

export interface StepView {
  readonly step: WorkflowStep;
  readonly state: StepState;
  readonly tone: Tone;
  /** Сколько проблем относится к шагу. Ноль — подписи нет. */
  readonly errors: number;
  readonly warnings: number;
}

const STATE_TONE: Readonly<Record<StepState, Tone>> = {
  error: 'danger',
  warning: 'warning',
  current: 'info',
  visited: 'success',
  pending: 'neutral',
};

export interface StepStateInput {
  readonly issues: readonly Issue[];
  readonly current: StepId;
  readonly visited: ReadonlySet<StepId>;
}

/**
 * Состояния всех шагов сразу.
 *
 * Ошибка перевешивает «текущий»: если на открытом шаге ошибка, человек
 * должен видеть именно её. Иначе шаг, на котором стоишь, выглядел бы
 * благополучным ровно тогда, когда на нём проблема.
 */
export function stepStates(input: StepStateInput): StepView[] {
  const errors = new Map<StepId, number>();
  const warnings = new Map<StepId, number>();

  for (const issue of input.issues) {
    const id = stepOfIssue(issue);
    if (id === undefined) continue;
    const bucket =
      issue.severity === 'error' ? errors : issue.severity === 'warning' ? warnings : undefined;
    if (bucket === undefined) continue;
    bucket.set(id, (bucket.get(id) ?? 0) + 1);
  }

  return WORKFLOW_STEPS.map((step) => {
    const stepErrors = errors.get(step.id) ?? 0;
    const stepWarnings = warnings.get(step.id) ?? 0;
    const state: StepState =
      stepErrors > 0
        ? 'error'
        : stepWarnings > 0
          ? 'warning'
          : step.id === input.current
            ? 'current'
            : input.visited.has(step.id)
              ? 'visited'
              : 'pending';
    return { step, state, tone: STATE_TONE[state], errors: stepErrors, warnings: stepWarnings };
  });
}

/**
 * Положение в сценарии (§29).
 *
 * Именно положение, а не процент выполнения: «67%» подразумевает, что
 * треть работы осталась, а это неизвестно — шаги не равны по объёму и
 * ни один из них не обязателен.
 */
export function stepPosition(current: StepId): string {
  return `${String(STEP_BY_ID[current].index)} из ${String(WORKFLOW_STEPS.length)}`;
}
