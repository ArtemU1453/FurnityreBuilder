import type { ReactNode } from 'react';
import { Dialog } from '../../design-system/index.js';
import type { LayoutMode } from '../layout.js';
import { usesSheets } from '../layout.js';
import styles from './Workspace.module.css';

/**
 * Колонка рабочей области — или лист снизу на телефоне (PROMPT 28 §7, §8).
 *
 * ## Одно содержимое, два места
 *
 * Панели шага и инспектор не переписываются под телефон: это те же
 * самые элементы, те же поля и те же команды. Меняется только то, где
 * они стоят — сбоку от холста или листом под ним. Второй набор панелей
 * означал бы, что телефон и десктоп правят разные вещи.
 *
 * ## Почему на телефоне именно лист
 *
 * Замер до изменения: на экране 390×844 холст занимал 347 px и начинался
 * на 179-м пикселе, а страница была 1719 px — то есть больше половины
 * работы уходило в прокрутку мимо изделия. Постоянная боковая колонка на
 * такой ширине не помещается ни в каком виде: её содержимое не
 * сжимается, оно просто уезжает вниз.
 *
 * ## Лист немодальный
 *
 * `modal={false}`: пока правишь ширину, изделие видно и на него можно
 * нажать. Модальный лист закрыл бы результат правки ровно в тот момент,
 * когда на него смотрят (§8 — «не блокировать canvas без
 * необходимости»).
 */

export interface WorkspaceSlotProps {
  readonly mode: LayoutMode;
  /** Колонка на широком экране: параметры слева, инспектор справа. */
  readonly side: 'sidebar' | 'inspector';
  readonly label: string;
  /** Заголовок листа на телефоне. Обычно — имя текущего шага или объекта. */
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

export function WorkspaceSlot(props: WorkspaceSlotProps): React.JSX.Element {
  if (!usesSheets(props.mode)) {
    return props.side === 'inspector' ? (
      <aside className={styles.inspector} aria-label={props.label}>
        {props.children}
      </aside>
    ) : (
      <div className={styles.sidebar}>{props.children}</div>
    );
  }

  return (
    <Dialog modal={false} open={props.open} title={props.title} onClose={props.onClose}>
      <div className={styles.sheetBody}>{props.children}</div>
    </Dialog>
  );
}
