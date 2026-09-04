import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Spring, planMotion, project, readMotionPreferences, spring } from '../motion/index.js';
import styles from './Dialog.module.css';

/**
 * Диалог на десктопе, лист снизу на телефоне (PROMPT 26 §20, §23, §27).
 *
 * ## Один компонент на оба случая
 *
 * Это не два разных элемента, а одна и та же вещь: остановить работу,
 * задать вопрос, получить ответ. Отличается только то, откуда она
 * приходит, — и это решает раскладка, а не вызывающий код. Заводить
 * отдельный `Sheet` значило бы дублировать фокус-ловушку, Esc, оверлей и
 * блокировку прокрутки.
 *
 * ## Нативный `<dialog>`
 *
 * Модальность, ловушка фокуса, возврат фокуса на место и обработка Esc —
 * всё это браузер уже умеет. Своя реализация каждой из этих вещей —
 * известный источник ошибок доступности, и ни одна из них не была бы
 * лучше.
 *
 * ## Жест закрытия листа — единственная пружина в интерфейсе
 *
 * Лист можно утянуть вниз пальцем. Пока палец на экране, лист идёт за
 * ним 1:1; на отпускании считается СПРОЕЦИРОВАННАЯ точка остановки
 * (`project`) — короткий резкий флик закрывает лист, медленное
 * перетаскивание на ту же дистанцию возвращает его на место. Скорость
 * жеста передаётся пружине, поэтому шва между «тяну» и «летит» нет.
 *
 * Именно здесь пружина уместна и больше нигде: остальные переходы в
 * приложении — смена состояния, а не продолжение жеста, и для них
 * достаточно перехода по токену (`docs/MOTION_GUIDELINES.md`).
 *
 * При `prefers-reduced-motion` жест остаётся (это прямое управление, а
 * не анимация), а доводка становится коротким затуханием.
 */

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  /** Пояснение: что произойдёт и чего это будет стоить. */
  readonly description?: string;
  readonly children?: ReactNode;
  /** Кнопки. Подтверждающая — первой в разметке, чтобы она была первой в фокусе. */
  readonly actions?: ReactNode;
  readonly onClose: () => void;
}

/** Доля высоты листа, за которой отпускание закрывает его. */
const DISMISS_FRACTION = 0.4;

export function Dialog(props: DialogProps): React.JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastAt: number;
    velocity: number;
  } | null>(null);
  const springRef = useRef<Spring | null>(null);
  const frameRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // Открытие и закрытие идут через методы <dialog>: только showModal()
  // делает диалог настоящим модальным — с ловушкой фокуса и inert-фоном.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    if (props.open && !node.open) node.showModal();
    if (!props.open && node.open) node.close();
  }, [props.open]);

  // Сброс смещения при каждом открытии: лист не должен появиться там, где
  // его оставил предыдущий жест.
  useEffect(() => {
    if (!props.open) return;
    setOffset(sheetRef.current, 0);
  }, [props.open]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    },
    [],
  );

  const settle = (from: number, to: number, velocity: number, onDone?: () => void): void => {
    const prefs = readMotionPreferences();
    const plan = planMotion(spring.sheet, prefs);
    const node = sheetRef.current;
    if (node === null) {
      onDone?.();
      return;
    }
    if (plan.kind === 'tween') {
      // Reduced motion: без пружины и без отскока — сразу к цели.
      setOffset(node, to);
      onDone?.();
      return;
    }

    const s = new Spring(from, plan.config, velocity);
    s.setTarget(to);
    springRef.current = s;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      setOffset(node, s.step(dt));
      if (s.settled) {
        frameRef.current = null;
        onDone?.();
        return;
      }
      frameRef.current = requestAnimationFrame(tick);
    };
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(tick);
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label={props.title}
      onCancel={(event) => {
        // Esc обрабатывается здесь, чтобы состояние `open` осталось
        // единственным источником правды: иначе браузер закрыл бы диалог,
        // а React считал бы его открытым.
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        // Щелчок по подложке закрывает: цель события — сам <dialog>
        // только тогда, когда попали мимо содержимого.
        if (event.target === ref.current) props.onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        data-dragging={dragging ? '' : undefined}
        onPointerDown={(event) => {
          // Тянуть можно только за верхнюю полосу: иначе прокрутка
          // содержимого и закрытие спорили бы за один и тот же жест.
          if (!(event.target as HTMLElement).closest(`.${styles.grabber}`)) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            pointerId: event.pointerId,
            startY: event.clientY,
            lastY: event.clientY,
            lastAt: event.timeStamp,
            velocity: 0,
          };
          if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag === null || drag.pointerId !== event.pointerId) return;
          const dt = (event.timeStamp - drag.lastAt) / 1000;
          if (dt > 0) drag.velocity = (event.clientY - drag.lastY) / dt;
          drag.lastY = event.clientY;
          drag.lastAt = event.timeStamp;
          // Вверх лист не тянется: там его некуда деть. Ноль, а не
          // резиновость — резиновость обещала бы, что сверху что-то есть.
          setOffset(sheetRef.current, Math.max(0, event.clientY - drag.startY));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (drag === null || drag.pointerId !== event.pointerId) return;
          dragRef.current = null;
          setDragging(false);
          const node = sheetRef.current;
          const height = node?.getBoundingClientRect().height ?? 0;
          const current = Math.max(0, event.clientY - drag.startY);
          // Решает не точка отпускания, а точка, где лист остановился бы
          // сам: короткий резкий флик закрывает, медленное перетаскивание
          // на ту же дистанцию — нет.
          const projected = current + project(drag.velocity);
          if (projected > height * DISMISS_FRACTION) {
            settle(current, height, drag.velocity, props.onClose);
          } else {
            settle(current, 0, drag.velocity);
          }
        }}
        onPointerCancel={() => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (drag !== null) settle(Math.max(0, drag.lastY - drag.startY), 0, 0);
        }}
      >
        <div className={styles.grabber} aria-hidden="true">
          <span className={styles.grabberBar} />
        </div>
        <h2 className={styles.title}>{props.title}</h2>
        {props.description === undefined ? null : (
          <p className={styles.description}>{props.description}</p>
        )}
        {props.children}
        {props.actions === undefined ? null : <div className={styles.actions}>{props.actions}</div>}
      </div>
    </dialog>
  );
}

function setOffset(node: HTMLElement | null, value: number): void {
  // Только transform: слой не перекомпоновывается, кадр остаётся дешёвым.
  if (node !== null) node.style.transform = `translate3d(0, ${String(value)}px, 0)`;
}
