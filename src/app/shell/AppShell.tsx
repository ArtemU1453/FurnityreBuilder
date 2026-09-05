import type { ReactNode } from 'react';
import { SegmentedControl } from '../../design-system/index.js';
import styles from './AppShell.module.css';

/**
 * Оболочка приложения (PROMPT 26 §3–§5).
 *
 * ## Один каркас на все экраны
 *
 * До этого этапа каркасов было два: `.shell` из PROMPT 5 (тулбар,
 * колонка параметров, панели) и `.editor` из PROMPT 22 (свой тулбар,
 * рабочая область, инспектор, строка состояния). Оба были живы
 * одновременно и висели на одном и том же элементе, причём классы
 * `.toolbar` и `.panelTitle` существовали в обоих файлах с разными
 * правилами. Переход между режимами выглядел как переход в другое
 * приложение — ровно то, что §5 запрещает.
 *
 * Теперь каркас один и всегда состоит из четырёх частей:
 *
 *     Верхняя строка   — проект, состояние, глобальные действия
 *     Навигация        — четыре экрана
 *     Содержимое       — экран
 *     Строка состояния — ошибки, готовность, сохранение
 *
 * ## Навигация — не второй маршрутизатор
 *
 * Адресов у экранов нет и не заводится: приложение работает без сервера
 * и без истории браузера, а один переключатель — это одно состояние.
 * Раньше их было два: `libraryOpen` булевым и `canvasMode` со значением
 * `'room'`, из-за чего «где я нахожусь» складывалось из двух ответов и
 * они могли противоречить друг другу.
 */

export type Screen = 'library' | 'editor' | 'room' | 'production';

export const SCREENS: readonly { readonly value: Screen; readonly label: string }[] = [
  { value: 'library', label: 'Библиотека' },
  { value: 'editor', label: 'Конструктор' },
  { value: 'room', label: 'Помещение' },
  { value: 'production', label: 'Производство' },
];

export interface AppShellProps {
  readonly screen: Screen;
  readonly onScreen: (screen: Screen) => void;
  /** Название проекта, габарит и состояние сохранения. */
  readonly context: ReactNode;
  /** Отмена, повтор, сохранение, экспорт. */
  readonly actions: ReactNode;
  /**
   * Сообщение обо всём приложении, а не о проекте: готовое обновление.
   *
   * Отдельный слот, а не строка состояния: та отвечает на вопросы о
   * ПРОЕКТЕ — есть ли ошибки, готов ли он, сохранён ли. «Вышла новая
   * версия» к проекту не относится, и смешивать это с его состоянием
   * значило бы заставить читать строку целиком, чтобы понять, о чём
   * речь (PROMPT 32 §7).
   */
  readonly banner?: ReactNode;
  readonly children: ReactNode;
  readonly status: ReactNode;
}

export function AppShell(props: AppShellProps): React.JSX.Element {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#main">
        Перейти к содержимому
      </a>

      <header className={styles.top}>
        <div className={styles.context}>{props.context}</div>
        <div className={styles.actions}>{props.actions}</div>
      </header>

      {/*
        Навигация — отдельная строка под контекстом, а не кнопки среди
        действий. Разница содержательная: «куда я иду» и «что я делаю с
        проектом» — разные вопросы, и смешивать их в одном ряду значит
        заставлять читать весь ряд, чтобы найти нужное.
      */}
      <nav className={styles.nav} aria-label="Разделы приложения">
        <SegmentedControl
          label="Раздел"
          value={props.screen}
          options={SCREENS}
          onChange={props.onScreen}
          stretch
        />
      </nav>

      {/*
        Контейнер рисуется ВСЕГДА, даже пустым. Дорожек в сетке пять, и
        элементов должно быть ровно столько же: убери контейнер по
        условию — и `main` попадёт в дорожку `auto` вместо
        `minmax(0, 1fr)`, перестав растягиваться на всю высоту. Пустой
        div в дорожке `auto` не занимает ничего.
      */}
      <div className={styles.banner}>{props.banner}</div>

      <main id="main" className={styles.content}>
        {props.children}
      </main>

      {props.status}
    </div>
  );
}
