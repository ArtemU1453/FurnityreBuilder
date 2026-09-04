import { useRef, useState } from 'react';
import { formatMm } from '../../domain/index.js';
import type { Project, ProjectId, ProjectPreview } from '../../domain/index.js';
import type { ProjectSummary } from '../../persistence/index.js';
import { SORT_LABELS } from '../../library/index.js';
import type { SortOrder } from '../../library/index.js';
import { Button, Dialog, EmptyState, Select, StatusIndicator } from '../../design-system/index.js';
import type { ProjectLibrary as Library } from '../use-project-library.js';
import styles from './ProjectLibrary.module.css';

/**
 * Библиотека проектов (PROMPT 25 §6, §25–§27).
 *
 * ## Карточка, а не строка таблицы
 *
 * Проект узнают по картинке. Список из строк «Новый проект,
 * 12.03.2026» не даёт отличить один шкаф от другого, и пользователь
 * открывает их по очереди, чтобы вспомнить, какой из них какой.
 *
 * ## Превью показывается через `<img>`, а не вставкой разметки
 *
 * Превью хранится в проекте, а проект можно ИМПОРТИРОВАТЬ из файла,
 * который приложение не создавало. Вставлять такой SVG в документ
 * значило бы выполнить чужой код на странице пользователя. Внутри
 * `<img>` SVG не исполняется и не может ничего загрузить — картинка
 * остаётся картинкой.
 */

export interface ProjectLibraryProps {
  readonly library: Library;
  readonly currentProjectId: ProjectId;
  readonly currentIsDirty: boolean;
  readonly onOpen: (project: Project) => void;
  readonly onExport: (project: Project) => void;
  /**
   * Сколько раз проект размещён в открытом помещении (§12).
   *
   * Нужен, чтобы удаление предупреждало о последствиях ДО того, как они
   * наступят. Считать это внутри библиотеки нельзя: помещение живёт в
   * открытом документе, а библиотека знает только сводки.
   */
  readonly placementsOf: (id: ProjectId) => number;
}

/** Дата в виде, в котором её читают: без секунд и без часового пояса. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Габарит для карточки: «1000 × 2000 × 500 мм». */
export function formatSize(size: ProjectSummary['size']): string {
  if (size === undefined) return 'Без изделий';
  return `${formatMm(size.width)} × ${formatMm(size.height)} × ${formatMm(size.depth)} мм`;
}

/** Картинка превью как data-URI. Вынесено, чтобы можно было проверить тестом. */
export function previewSource(preview: ProjectPreview): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preview.svg)}`;
}

export function ProjectLibrary(props: ProjectLibraryProps): React.JSX.Element {
  const library = props.library;
  const fileRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState<ProjectId | undefined>(undefined);
  const [draftName, setDraftName] = useState('');
  // Удаление подтверждается на самой карточке (§12): проект — это часы
  // работы, и одна случайная кнопка не должна их стирать. Диалога нет
  // намеренно — подтверждение стоит там же, где действие.
  const [confirming, setConfirming] = useState<ProjectId | undefined>(undefined);
  const pending = library.visible.find((summary) => summary.id === confirming);

  const open = (id: ProjectId): void => {
    void (async () => {
      const project = await library.open(id);
      if (project !== undefined) props.onOpen(project);
    })();
  };

  const exportOne = (id: ProjectId): void => {
    void (async () => {
      const project = await library.open(id);
      if (project !== undefined) props.onExport(project);
    })();
  };

  return (
    <section className={styles.library} aria-label="Библиотека проектов">
      <div className={styles.header}>
        <h2 className={styles.title}>Мои проекты</h2>
        <div className={styles.controls}>
          <label>
            <span className={styles.recentLabel}>Поиск </span>
            <input
              className={styles.search}
              type="search"
              value={library.query}
              placeholder="Имя проекта"
              onChange={(event) => {
                library.setQuery(event.target.value);
              }}
            />
          </label>
          <Select
            label="Порядок"
            value={library.order}
            options={Object.entries(SORT_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(value) => {
              library.setOrder(value as SortOrder);
            }}
          />
          <Button
            variant="primary"
            onClick={() => {
              void (async () => {
                const created = await library.create();
                if (created !== undefined) props.onOpen(created);
              })();
            }}
          >
            Создать проект
          </Button>
          <Button
            onClick={() => {
              fileRef.current?.click();
            }}
          >
            Импорт из файла
          </Button>
          <input
            ref={fileRef}
            className={styles.hiddenInput}
            type="file"
            accept="application/json,.json"
            aria-label="Файл проекта"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Значение сбрасывается, иначе повторный выбор того же файла
              // не вызовет события и импорт «не сработает».
              event.target.value = '';
              if (file === undefined) return;
              void (async () => {
                const result = await library.importText(await file.text());
                if (result.status === 'READY') props.onOpen(result.project);
              })();
            }}
          />
        </div>
      </div>

      {/*
        Режим без постоянного хранилища — не мелочь: всё, что пользователь
        сделает, исчезнет с закрытием вкладки. Молчать об этом нельзя.
      */}
      {library.ephemeral ? (
        <StatusIndicator
          tone="warning"
          label="Постоянное хранилище недоступно"
          detail="Приватный режим: проекты живут только в этой вкладке — сохраните их файлом."
        />
      ) : null}

      {props.currentIsDirty ? (
        <StatusIndicator
          tone="warning"
          label="В открытом проекте есть несохранённые изменения"
          detail="Откройте другой проект только после сохранения — иначе правки будут потеряны."
        />
      ) : null}

      {library.error === undefined ? null : (
        <StatusIndicator tone="danger" label={library.error} live />
      )}

      {library.recent.length === 0 ? null : (
        <ul className={styles.recent} aria-label="Недавние проекты">
          <li className={styles.recentLabel}>Недавние:</li>
          {library.recent.map((summary) => (
            <li key={summary.id}>
              <Button
                variant="ghost"
                onClick={() => {
                  open(summary.id);
                }}
              >
                {summary.name}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {library.loading ? (
        <EmptyState tone="loading" title="Загружается…" />
      ) : library.visible.length === 0 ? (
        library.summaries.length === 0 ? (
          <EmptyState
            title="Проектов пока нет"
            description="Создайте первый проект мебели или откройте файл, сохранённый раньше."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  void (async () => {
                    const created = await library.create();
                    if (created !== undefined) props.onOpen(created);
                  })();
                }}
              >
                Создать проект
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Ничего не найдено"
            description={`По запросу «${library.query}» проектов нет. Попробуйте другое слово или очистите поиск.`}
            action={
              <Button
                onClick={() => {
                  library.setQuery('');
                }}
              >
                Очистить поиск
              </Button>
            }
          />
        )
      ) : (
        <ul className={styles.grid} aria-label="Проекты">
          {library.visible.map((summary) => {
            const current = summary.id === props.currentProjectId;
            const placed = props.placementsOf(summary.id);
            return (
              <li
                key={summary.id}
                className={`${styles.card} ${current ? styles.cardCurrent : ''}`.trim()}
              >
                <div className={styles.preview}>
                  {summary.preview === undefined ? (
                    <div className={styles.previewEmpty}>Превью появится после сохранения</div>
                  ) : (
                    <img
                      src={previewSource(summary.preview)}
                      alt={`Превью проекта «${summary.name}»`}
                    />
                  )}
                </div>

                {renaming === summary.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void library.rename(summary.id, draftName);
                      setRenaming(undefined);
                    }}
                  >
                    <input
                      className={styles.search}
                      autoFocus
                      value={draftName}
                      aria-label="Новое имя проекта"
                      onChange={(event) => {
                        setDraftName(event.target.value);
                      }}
                    />
                    <Button type="submit" variant="primary">
                      Сохранить имя
                    </Button>
                  </form>
                ) : (
                  <h3 className={styles.name}>{summary.name}</h3>
                )}

                <p className={styles.meta}>
                  {formatDate(summary.updatedAt)} · {formatSize(summary.size)}
                </p>
                <p className={styles.status}>
                  {summary.furnitureCount === 0
                    ? 'Изделий нет'
                    : `Изделий: ${String(summary.furnitureCount)}`}
                  {current ? ' · открыт' : ''}
                  {placed === 0 ? '' : ` · в помещении: ${String(placed)}`}
                </p>

                <div className={styles.cardActions}>
                  <Button
                    variant="primary"
                    disabled={current}
                    onClick={() => {
                      open(summary.id);
                    }}
                  >
                    Открыть
                  </Button>
                  <Button
                    onClick={() => {
                      setRenaming(summary.id);
                      setDraftName(summary.name);
                    }}
                  >
                    Переименовать
                  </Button>
                  <Button
                    onClick={() => {
                      void library.duplicate(summary.id);
                    }}
                  >
                    Дублировать
                  </Button>
                  <Button
                    onClick={() => {
                      exportOne(summary.id);
                    }}
                  >
                    Экспорт
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setConfirming(summary.id);
                    }}
                  >
                    Удалить
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/*
        Подтверждение удаления — общий диалог приложения (§20), а не
        собственная пара кнопок на карточке. Проект — это часы работы, и
        необратимое действие обязано выглядеть одинаково везде: на
        телефоне тот же компонент приходит листом снизу.
      */}
      <Dialog
        open={pending !== undefined}
        title={pending === undefined ? '' : `Удалить «${pending.name}»?`}
        description={
          pending === undefined || props.placementsOf(pending.id) === 0
            ? 'Проект будет удалён без возможности вернуть. Сохраните его файлом, если он ещё нужен.'
            : `Проект размещён в помещении ${String(props.placementsOf(pending.id))} раз(а). ` +
              'Размещения останутся и будут отмечены как недоступные — расстановка не пропадёт молча.'
        }
        onClose={() => {
          setConfirming(undefined);
        }}
        actions={
          <>
            <Button
              variant="danger"
              onClick={() => {
                if (pending !== undefined) void library.remove(pending.id);
                setConfirming(undefined);
              }}
            >
              Удалить
            </Button>
            <Button
              onClick={() => {
                setConfirming(undefined);
              }}
            >
              Отмена
            </Button>
          </>
        }
      />
    </section>
  );
}
