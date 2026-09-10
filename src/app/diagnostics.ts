import { APP_VERSION, BUILD_ID } from './version.js';

/**
 * Данные для отчёта об ошибке (PROMPT 45 §8, §9).
 *
 * ## Зачем они вообще нужны
 *
 * Сообщение «у меня не считается» невозможно расследовать: неизвестно ни
 * что за сборка, ни что за браузер, ни где именно оборвалось. Версию в
 * строке состояния показывает `StatusBar` ровно по этой причине — но
 * версии одной мало, когда речь об исключении.
 *
 * ## Чем это НЕ является
 *
 * Это не телеметрия. Данные собираются на устройстве, показываются
 * человеку целиком и уходят наружу только тогда, когда он сам их
 * скопировал и сам куда-то вставил. Ни одного сетевого запроса этот
 * модуль не делает и делать не может: здесь нет ни `fetch`, ни адреса,
 * ни очереди отправки. Отсутствие внешних запросов проверяется отдельно
 * — `npm run check:brand` и `tests/e2e/app.spec.ts`.
 *
 * ## Чего здесь нет намеренно
 *
 * Ни проекта, ни его габаритов, ни материалов, ни имени файла, ни
 * содержимого хранилища. Отчёт об ошибке не должен требовать от
 * человека выложить свою работу, чтобы им можно было воспользоваться:
 * «пришлите диагностику» и «пришлите ваш проект» — разные просьбы, и
 * вторая задаётся отдельно и осознанно.
 *
 * Формально это выражено формой `DiagnosticInput`: положить туда проект
 * нельзя — такого поля просто нет.
 */

/** Где произошёл сбой. Категория, а не состояние: без данных проекта. */
export type DiagnosticCategory =
  | 'app'
  | 'editor'
  | 'scene'
  | 'room'
  | 'library'
  | 'production'
  | 'export'
  | 'storage'
  | 'unhandled';

const CATEGORY_LABEL: Record<DiagnosticCategory, string> = {
  app: 'Приложение',
  editor: 'Конструктор',
  scene: 'Трёхмерный вид',
  room: 'Помещение',
  library: 'Библиотека проектов',
  production: 'Производство',
  export: 'Экспорт документов',
  storage: 'Хранилище проектов',
  unhandled: 'Непредвиденная ошибка',
};

export interface DiagnosticInput {
  readonly version: string;
  readonly build: string;
  readonly userAgent: string;
  readonly category: DiagnosticCategory;
  readonly message: string;
  /** Стек — по желанию и в обрезанном виде: см. `STACK_FRAMES`. */
  readonly stack?: string | undefined;
  readonly at: string;
}

/**
 * Сколько строк стека попадает в отчёт.
 *
 * Верхние кадры отвечают на вопрос «где оборвалось»; остальное — путь
 * через React и планировщик, одинаковый у любой ошибки. Обрезка нужна не
 * ради краткости: чем длиннее текст, тем меньше вероятность, что человек
 * прочитает его перед отправкой, а прочитать он должен.
 */
const STACK_FRAMES = 8;

/**
 * Строит текст отчёта.
 *
 * Функция чистая: всё, что попадёт в отчёт, приходит аргументом. Именно
 * поэтому её можно проверить тестом на приватность — проверяется то же
 * самое, что увидит пользователь (§15).
 */
export function formatDiagnostics(input: DiagnosticInput): string {
  const lines = [
    'Furniture Builder — данные для отчёта об ошибке',
    `Версия: ${input.version}`,
    `Сборка: ${input.build}`,
    `Раздел: ${CATEGORY_LABEL[input.category]} (${input.category})`,
    `Ошибка: ${input.message}`,
    `Время: ${input.at}`,
    `Браузер: ${input.userAgent}`,
  ];

  const stack = input.stack?.trim();
  if (stack !== undefined && stack !== '') {
    lines.push('', 'Стек:', ...stack.split('\n').slice(0, STACK_FRAMES).map((line) => line.trim()));
  }

  lines.push(
    '',
    'В этих данных нет ни проекта, ни его размеров, ни содержимого хранилища.',
    'Приложение никуда их не отправляет: скопировать и приложить к сообщению',
    'об ошибке может только сам пользователь.',
  );

  return lines.join('\n');
}

/** Читает то немногое об окружении, что известно приложению. */
function userAgent(): string {
  return typeof navigator === 'undefined' ? 'неизвестен' : navigator.userAgent;
}

export interface CollectOptions {
  readonly category: DiagnosticCategory;
  readonly error: unknown;
  /** Момент приходит снаружи: так отчёт воспроизводим в тесте. */
  readonly now?: () => string;
}

/** Собирает отчёт по настоящей ошибке и настоящему окружению. */
export function collectDiagnostics(options: CollectOptions): string {
  const error = options.error;
  const now = options.now ?? (() => new Date().toISOString());
  return formatDiagnostics({
    version: APP_VERSION,
    build: BUILD_ID,
    userAgent: userAgent(),
    category: options.category,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    at: now(),
  });
}
