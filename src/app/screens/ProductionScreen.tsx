import { Button, EmptyState, Panel, StatusIndicator } from '../../design-system/index.js';
import type { ProductionReadinessResult } from '../../workflow/index.js';
import { CHECK_MARK, CHECK_STATUS, PRODUCTION_STATUS } from '../status.js';
import styles from './ProductionScreen.module.css';

/**
 * Экран производства (PROMPT 26 §26).
 *
 * ## Почему экран, а не панель в боковой колонке
 *
 * Производственная документация была одной из девяти панелей в колонке
 * параметров редактора — между «Габаритами» и «Сеткой». Задание §3
 * называет производство одним из четырёх разделов приложения, и это
 * верно по существу: сюда приходят, когда изделие уже спроектировано, и
 * здесь принимают решение — заказывать материал или доделывать.
 * Соседство с полем «ширина» этому решению не помогало.
 *
 * ## Отдельного дизайна у раздела нет
 *
 * Те же `Panel`, `StatusIndicator`, `Button` и те же слова, что и везде
 * (§26). Чеклист готовности строится из доменного результата и ничего не
 * проверяет сам.
 *
 * ## «Рассчитать» здесь нет и быть не может
 *
 * Все производственные величины — производные: они пересчитываются из
 * проекта и нигде не хранятся. Кнопка «Рассчитать» обещала бы, что
 * бывает состояние «посчитано» и «не посчитано», а его не существует.
 * Пустое состояние здесь — только когда расчёт невозможен.
 */

export interface ProductionScreenProps {
  readonly readiness: ProductionReadinessResult | undefined;
  readonly exporting: 'pdf' | 'xlsx' | null;
  readonly exportError: string | null;
  readonly onExport: (kind: 'pdf' | 'xlsx') => void;
}

export function ProductionScreen(props: ProductionScreenProps): React.JSX.Element {
  const readiness = props.readiness;

  return (
    <>
      <Panel
        id="production-readiness"
        title="Готовность к производству"
        subtitle="Спецификация деталей, фурнитура, присадка и карта раскроя. Расчёт производный: отдельного «пересчитать» не требуется."
        wide
      >
        {readiness === undefined ? (
          <EmptyState
            title="Расчёт недоступен"
            description="В проекте нет изделия, для которого можно построить деталировку."
          />
        ) : (
          <>
            <StatusIndicator
              tone={PRODUCTION_STATUS[readiness.status].tone}
              label={PRODUCTION_STATUS[readiness.status].label}
              {...(PRODUCTION_STATUS[readiness.status].hint === undefined
                ? {}
                : { detail: PRODUCTION_STATUS[readiness.status].hint })}
              live
            />

            {/*
              Список, а не таблица: каждый пункт — самостоятельное
              утверждение о разделе, и читать его нужно построчно, в том
              числе скринридером.
            */}
            <ul className={styles.checks}>
              {readiness.checks.map((check) => (
                <li
                  key={check.id}
                  className={styles.check}
                  data-tone={CHECK_STATUS[check.status].tone}
                >
                  <span className={styles.mark} aria-hidden="true">
                    {CHECK_MARK[check.status]}
                  </span>
                  <span className={styles.title}>{check.title}</span>
                  <span className={styles.detail}>
                    {CHECK_STATUS[check.status].label} · {check.details}
                  </span>
                  {check.errors.length === 0 ? null : (
                    <span className={styles.detail}>{check.errors[0]?.message}</span>
                  )}

                  {/*
                    Неподтверждённые правила раскрываются, а не сводятся к
                    слову «подтвердить» (PROMPT 27 §25). У каждого уже
                    есть всё нужное: какое правило неизвестно, где оно
                    применяется и на что влияет результат. Прятать это за
                    статусом значило бы требовать подтверждения, не
                    сказав чего.
                  */}
                  {check.needsConfirmation.length === 0 ? null : (
                    <ul className={styles.confirmations}>
                      {check.needsConfirmation.map((item) => (
                        <li key={item.id} className={styles.confirmation}>
                          <span className={styles.rule}>{item.rule}</span>
                          <span className={styles.detail}>Применяется: {item.source}</span>
                          <span className={styles.detail}>Влияние: {item.impact}</span>
                          <span className={styles.detail}>Идентификатор: {item.id}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel
        id="production-export"
        title="Документы"
        subtitle="Формируются в браузере. Ни один байт проекта не уходит в сеть."
        wide
      >
        <div className={styles.actions}>
          <Button
            variant="primary"
            onClick={() => {
              props.onExport('pdf');
            }}
            loading={props.exporting === 'pdf'}
            disabled={props.exporting !== null}
          >
            {props.exporting === 'pdf' ? 'Формируется PDF…' : 'Скачать PDF'}
          </Button>
          <Button
            onClick={() => {
              props.onExport('xlsx');
            }}
            loading={props.exporting === 'xlsx'}
            disabled={props.exporting !== null}
          >
            {props.exporting === 'xlsx' ? 'Формируется XLSX…' : 'Скачать XLSX'}
          </Button>
        </div>

        {/* Результат действия не должен быть виден только глазами. */}
        <p className={styles.message} role="status" aria-live="polite">
          {props.exportError ?? (props.exporting === null ? '' : 'Идёт формирование документа…')}
        </p>
      </Panel>
    </>
  );
}
