import {
  Button,
  EmptyState,
  Panel,
  SegmentedControl,
  Select,
  StatusIndicator,
} from '../../design-system/index.js';
import type { MaterialLibrary } from '../../domain/index.js';
import type { ProductionReadinessResult } from '../../workflow/index.js';
import { CHECK_MARK, CHECK_STATUS, PRODUCTION_STATUS } from '../status.js';
import { PRODUCTION_SECTIONS, SECTION_BY_ID, usesSectionList } from '../production/index.js';
import type { ProductionSectionId } from '../production/index.js';
import type { LayoutMode } from '../layout.js';
import { DrawingsSection, DrillingSection, PartsSection } from './production/ProductionParts.js';
import { BomSection, CuttingSection, HardwareSection } from './production/ProductionCutting.js';
import type { ProductionActions, ProductionData, SelectionState } from './production/types.js';
import sectionStyles from './production/ProductionSections.module.css';
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
 *
 * По той же причине не существует и «устаревшего результата» (PROMPT 29
 * §33): показать его нельзя, потому что его негде взять — расчёт
 * выводится из проекта в момент показа. Состояние расчёта (§34) при этом
 * показывается настоящее: `ProductionCalculationResult.status` и
 * `ProductionReadinessResult.status`, а не выдуманная шкала прогресса.
 *
 * ## Восемь разделов — один расчёт (PROMPT 29 §2, §43)
 *
 * Разделы получают ОДИН уже посчитанный результат сверху. Восемь
 * разделов, каждый со своим `calculateProduction`, — это восемь
 * конвейеров вместо одного, и выбор детали запускал бы их все.
 */

export interface ProductionScreenProps {
  readonly readiness: ProductionReadinessResult | undefined;
  /** Уже посчитанный результат: разделы ничего не считают сами. */
  readonly data: ProductionData | undefined;
  readonly selection: SelectionState;
  readonly actions: ProductionActions;
  readonly section: ProductionSectionId;
  readonly onSection: (id: ProductionSectionId) => void;
  readonly layout: LayoutMode;
  readonly materials: MaterialLibrary;
  /**
   * Плотный вид для телефона (PROMPT 28 §30, §31).
   *
   * Разворачивать нечего, пока не спросили: восемь разделов, у каждого
   * до четырёх строк на каждое неподтверждённое правило, дают на
   * телефоне экран, по которому нужно прокрутить всё, чтобы найти одну
   * проблему. Свёрнуты при этом ТОЛЬКО уточнения — ошибки видны всегда
   * (§33): прятать то, что мешает изготовить, за нажатием нельзя.
   */
  readonly compact?: boolean;
  readonly exporting: 'pdf' | 'xlsx' | null;
  readonly exportError: string | null;
  readonly onExport: (kind: 'pdf' | 'xlsx') => void;
}

export function ProductionScreen(props: ProductionScreenProps): React.JSX.Element {
  const readiness = props.readiness;
  const options = PRODUCTION_SECTIONS.map((section) => ({
    value: section.id,
    label: section.title,
  }));

  return (
    <>
      {/*
        Переключатель разделов. На телефоне восемь сегментов в строку не
        помещаются, поэтому там список — та же величина и тот же выбор,
        одна цель для пальца (PROMPT 29 §40).
      */}
      {usesSectionList(props.layout) ? (
        <Select
          label="Раздел производства"
          value={props.section}
          options={options}
          onChange={(value) => {
            props.onSection(value as ProductionSectionId);
          }}
          hint={SECTION_BY_ID[props.section].hint}
        />
      ) : (
        <SegmentedControl
          label="Раздел производства"
          value={props.section}
          options={options}
          onChange={props.onSection}
        />
      )}

      {props.section !== 'overview' ? null : (
        <ProductionOverview data={props.data} readiness={readiness} onSection={props.onSection} />
      )}

      {props.data === undefined ? (
        props.section === 'overview' || props.section === 'documentation' ? null : (
          <Panel id="production-unavailable" title={SECTION_BY_ID[props.section].title} wide>
            <EmptyState
              title="Расчёт недоступен"
              description="В проекте нет изделия, для которого можно построить деталировку."
            />
          </Panel>
        )
      ) : (
        <ProductionBody
          section={props.section}
          data={props.data}
          selection={props.selection}
          actions={props.actions}
          materials={props.materials}
        />
      )}

      {props.section !== 'overview' ? null : (
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

                    На телефоне тот же список лежит в раскрывающемся
                    блоке (§31): содержимое то же самое, но восемь
                    разделов сразу не превращают экран в простыню.
                    Заголовок при этом честный — он говорит, сколько
                    правил ждёт уточнения, а не просто «подробнее».
                  */}
                    {check.needsConfirmation.length === 0 ? null : props.compact === true ? (
                      <details className={styles.disclosure}>
                        <summary className={styles.summary}>
                          Требуется уточнение: {check.needsConfirmation.length}
                        </summary>
                        {confirmations(check.needsConfirmation)}
                      </details>
                    ) : (
                      confirmations(check.needsConfirmation)
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}

      {props.section !== 'documentation' && props.section !== 'overview' ? null : (
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
      )}
    </>
  );
}

/**
 * Сводка (PROMPT 29 §3, §38).
 *
 * Все числа — из `ProductionCalculationResult`. Ни одно из них не
 * считается здесь заново: сводка, которая считает сама, рано или поздно
 * расходится с документом, который она обещает.
 */
function ProductionOverview({
  data,
  readiness,
  onSection,
}: {
  readonly data: ProductionData | undefined;
  readonly readiness: ProductionReadinessResult | undefined;
  readonly onSection: (id: ProductionSectionId) => void;
}): React.JSX.Element | null {
  if (data === undefined || readiness === undefined) return null;
  const bom = data.calculation.bom;

  const facts: readonly {
    readonly id: ProductionSectionId;
    readonly term: string;
    readonly value: string;
  }[] = [
    { id: 'parts', term: 'Позиций деталировки', value: String(bom.parts.length) },
    {
      id: 'parts',
      term: 'Деталей всего',
      value: String(bom.parts.reduce((sum, item) => sum + item.quantity, 0)),
    },
    { id: 'cutting', term: 'Листов раскроя', value: String(bom.cutting.stockCount) },
    { id: 'cutting', term: 'Не размещено', value: String(bom.cutting.unplacedParts) },
    { id: 'drilling', term: 'Операций присадки', value: String(bom.drilling.operationCount) },
    {
      id: 'hardware',
      term: 'Позиций фурнитуры',
      value: String(bom.hardware.lines.reduce((sum, line) => sum + line.quantity, 0)),
    },
    {
      id: 'cutting',
      term: 'Использование листа',
      value: `${(bom.cutting.utilization * 100).toFixed(1)} %`,
    },
  ];

  return (
    <Panel
      id="production-overview"
      title="Сводка"
      subtitle="Что получится, если выпустить документы прямо сейчас. Числа — те же, что уйдут в файл."
      wide
    >
      <dl className={sectionStyles.facts}>
        {facts.map((fact) => (
          <div key={`${fact.id}-${fact.term}`} className={sectionStyles.fact}>
            <dt>
              <button
                type="button"
                className={sectionStyles.link}
                onClick={() => {
                  onSection(fact.id);
                }}
              >
                {fact.term}
              </button>
            </dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** Раздел, который сейчас открыт. Данные приходят посчитанными сверху. */
function ProductionBody({
  section,
  data,
  selection,
  actions,
  materials,
}: {
  readonly section: ProductionSectionId;
  readonly data: ProductionData;
  readonly selection: SelectionState;
  readonly actions: ProductionActions;
  readonly materials: MaterialLibrary;
}): React.JSX.Element | null {
  switch (section) {
    case 'parts':
      return <PartsSection data={data} selection={selection} actions={actions} />;
    case 'drawings':
      return <DrawingsSection data={data} selection={selection} />;
    case 'drilling':
      return <DrillingSection data={data} selection={selection} actions={actions} />;
    case 'cutting':
      return (
        <CuttingSection data={data} selection={selection} actions={actions} materials={materials} />
      );
    case 'hardware':
      return <HardwareSection data={data} actions={actions} />;
    case 'bom':
      return <BomSection data={data} />;
    case 'overview':
    case 'documentation':
      return null;
  }
}

/** Список неподтверждённых правил. Одна разметка на оба вида экрана. */
function confirmations(
  items: ProductionReadinessResult['checks'][number]['needsConfirmation'],
): React.JSX.Element {
  return (
    <ul className={styles.confirmations}>
      {items.map((item) => (
        <li key={item.id} className={styles.confirmation}>
          <span className={styles.rule}>{item.rule}</span>
          <span className={styles.detail}>Применяется: {item.source}</span>
          <span className={styles.detail}>Влияние: {item.impact}</span>
          <span className={styles.detail}>Идентификатор: {item.id}</span>
        </li>
      ))}
    </ul>
  );
}
