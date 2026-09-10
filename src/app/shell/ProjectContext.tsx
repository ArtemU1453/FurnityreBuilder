import { formatMm } from '../../domain/index.js';
import type { Dimensions } from '../../domain/index.js';
import { StatusIndicator } from '../../design-system/index.js';
import { STORAGE_STATUS } from '../status.js';
import type { StorageStatus } from '../use-project-storage.js';
import styles from './AppShell.module.css';
import own from './ProjectContext.module.css';

/**
 * Контекст проекта в верхней строке (PROMPT 26 §6).
 *
 * Три вещи и ровно один раз каждая: какой проект открыт, какого он
 * размера и сохранён ли он. До этого этапа имя проекта было в тулбаре,
 * состояние сохранения — и в тулбаре, и в строке состояния разными
 * словами, а габарит не показывался нигде, кроме полей ввода.
 *
 * Габарит — первого изделия: он и есть «размер проекта» в том же
 * смысле, в каком его показывает карточка библиотеки. Второго ответа на
 * этот вопрос в приложении быть не должно.
 */

export interface ProjectContextProps {
  readonly name: string;
  readonly size: Dimensions | undefined;
  readonly storage: StorageStatus;
  /**
   * Подробность записи, если она конкретнее общей подсказки:
   * приватный режим, причина ошибки. Без неё показывается `hint`
   * состояния — см. ниже, почему это важно.
   */
  readonly storageDetail?: string;
}

export function ProjectContext(props: ProjectContextProps): React.JSX.Element {
  const status = STORAGE_STATUS[props.storage];
  return (
    <>
      <h1 className={own.name}>{props.name}</h1>
      {props.size === undefined ? null : (
        <p className={own.size}>
          {formatMm(props.size.width)} × {formatMm(props.size.height)} ×{' '}
          {formatMm(props.size.depth)} мм
        </p>
      )}
      {/*
        Подробность: сначала конкретная, потом общая подсказка состояния
        (PROMPT 48, UX-01).

        До этого аудита `hint` из `STORAGE_STATUS` не показывался НИГДЕ —
        ни для одного состояния. Хуже всего это било по отказу записи:
        человек видел «Не удалось сохранить», но не видел единственного
        совета, который спасал работу, — «выгрузите проект файлом».
        Проверено настоящим отказом IndexedDB: после перезагрузки правки
        не возвращались, а на экране не было сказано, как их сохранить.

        Приоритет у `storageDetail`: «только память вкладки» конкретнее
        любой общей фразы, и подменять его подсказкой нельзя.
      */}
      <StatusIndicator
        tone={status.tone}
        label={status.label}
        {...(() => {
          const detail = props.storageDetail ?? status.hint;
          return detail === undefined ? {} : { detail };
        })()}
        compact
        live
      />
    </>
  );
}

/** Класс строки-обёртки: экспортируется, чтобы оболочка не знала о вёрстке. */
export const contextClass = styles.context;
