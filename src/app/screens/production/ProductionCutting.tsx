import { useMemo } from 'react';
import { formatMm } from '../../../domain/index.js';
import { EmptyState, Panel, StatusIndicator } from '../../../design-system/index.js';
import { CuttingMap, buildCuttingView } from '../../../render/index.js';
import type { MaterialLibrary } from '../../../domain/index.js';
import type { HardwareItem } from '../../../hardware/index.js';
import type { PartBOMItem } from '../../../bom/index.js';
import { itemOfSourcePart } from '../../production/index.js';
import type { ProductionActions, ProductionData, SelectionState } from './types.js';
import styles from './ProductionSections.module.css';
import { hardwareKindLabel, hardwareUnitLabel } from '../../vocabulary.js';
import { unplacedReasonLabel } from '../../../production/index.js';

/**
 * Раскрой, фурнитура и спецификация (PROMPT 29 §19–§26).
 *
 * ## Нового алгоритма раскладки нет
 *
 * Карта показывает `CuttingLayout` как его посчитал Cutting Engine:
 * координаты, повороты, отход и использование — его числа. Ни
 * переразмещения, ни «оптимизации» здесь нет и быть не должно (§19, §22).
 *
 * ## Неразмещённые детали видны всегда
 *
 * Список деталей, которые алгоритм разместить не смог, стоит рядом с
 * листами, а не прячется за фильтром: лист без них выглядит как удачный
 * раскрой, а раскрой неполный (§23).
 */

export interface CuttingSectionProps {
  readonly data: ProductionData;
  readonly selection: SelectionState;
  readonly actions: ProductionActions;
  readonly materials: MaterialLibrary;
}

export function CuttingSection({
  data,
  selection,
  actions,
  materials,
}: CuttingSectionProps): React.JSX.Element {
  const cutting = data.calculation.cutting;
  const summary = data.calculation.bom.cutting;
  const view = useMemo(() => buildCuttingView(cutting, materials), [cutting, materials]);

  // Подсветка на карте — идентификаторы размещений выбранной позиции.
  // Второго состояния выбора для карты не заводится: выбранная деталь
  // одна на все разделы (§29).
  const highlighted = useMemo(
    () => new Set((selection.trace?.placements ?? []).map((placement) => placement.id)),
    [selection.trace],
  );

  return (
    <>
      <Panel
        id="production-cutting"
        title="Раскрой"
        subtitle="Карты листов как их посчитал раскрой. Детали не перемещаются: это не редактор раскладки."
        wide
      >
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Листов</dt>
            <dd>{summary.stockCount}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Размещено</dt>
            <dd>{summary.placedParts}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Не размещено</dt>
            <dd>{summary.unplacedParts}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Использование</dt>
            <dd>{`${(summary.utilization * 100).toFixed(1)} %`}</dd>
          </div>
          <div className={styles.fact}>
            <dt>Отход</dt>
            <dd>{`${(summary.wasteArea / 1_000_000).toFixed(2)} м²`}</dd>
          </div>
        </dl>

        {cutting.layouts.length === 0 ? (
          <EmptyState
            compact
            title="Листов не рассчитано"
            description="Раскрой не построил ни одного листа: в проекте нет деталей или не задан формат материала."
          />
        ) : (
          <CuttingMap
            view={view}
            highlightedRectIds={highlighted}
            onSelectRect={(rectId) => {
              // Прямоугольник на карте → позиция деталировки. Связь уже
              // есть в `CuttingPlacement.productionPartId`, и здесь она
              // только читается (§20).
              const placement = cutting.layouts
                .flatMap((layout) => layout.placements)
                .find((entry) => entry.id === rectId);
              if (placement === undefined) return;
              // Позиция ищется по производственной детали, а не по своему
              // идентификатору: `bom:…` и `pp:…` — разные сущности.
              const item = data.calculation.bom.parts.find((entry) =>
                entry.productionPartIds.includes(placement.productionPartId),
              );
              actions.onSelectItem(item);
            }}
          />
        )}
      </Panel>

      {cutting.unplaced.length === 0 ? null : (
        <Panel
          id="production-unplaced"
          title="Не размещено"
          subtitle="Эти детали раскрой разместить не смог. Пока они здесь, раскрой неполон."
          tone="sunken"
          wide
        >
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Неразмещённые детали</caption>
              <thead>
                <tr>
                  <th scope="col">Деталь</th>
                  <th scope="col">Экземпляр</th>
                  <th scope="col">Размер</th>
                  <th scope="col">Материал</th>
                  <th scope="col">Причина</th>
                </tr>
              </thead>
              <tbody>
                {cutting.unplaced.map((entry) => {
                  const part = cutting.productionParts.find(
                    (candidate) => candidate.id === entry.productionPartId,
                  );
                  const item = itemOfSourcePart(data.calculation.bom.parts, entry.sourcePartId);
                  return (
                    <tr key={`${entry.productionPartId}-${String(entry.instanceIndex)}`}>
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.link}
                          onClick={() => {
                            actions.onSelectItem(item);
                          }}
                        >
                          {part?.name ?? entry.productionPartId}
                        </button>
                      </th>
                      <td className={styles.num}>{entry.instanceIndex + 1}</td>
                      <td className={styles.num}>
                        {part === undefined
                          ? '—'
                          : `${formatMm(part.length)} × ${formatMm(part.width)}`}
                      </td>
                      <td>{item?.materialName ?? '—'}</td>
                      <td>{`${unplacedReasonLabel(entry.reason)} · ${entry.detail}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

/** Спецификация фурнитуры и её источники (§24, §25). */
export function HardwareSection({
  data,
  actions,
}: {
  readonly data: ProductionData;
  readonly actions: ProductionActions;
}): React.JSX.Element {
  const hardware = data.calculation.hardware;

  return (
    <Panel
      id="production-hardware"
      title="Фурнитура"
      subtitle="Позиции и правила, по которым они получены. Поставщиков и цен здесь нет и не будет."
      wide
    >
      {hardware.errors.length === 0 ? null : (
        <ul className={styles.problems} data-tone="danger">
          {hardware.errors.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}
      {hardware.warnings.length === 0 ? null : (
        <ul className={styles.problems} data-tone="warning">
          {hardware.warnings.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}

      {hardware.lines.length === 0 ? (
        <EmptyState
          compact
          title="Позиций не рассчитано"
          description="Правила фурнитуры не дали ни одной позиции. Причины — в списке выше: правило либо неприменимо, либо ждёт подтверждения нормы."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>Спецификация фурнитуры</caption>
            <thead>
              <tr>
                <th scope="col">Наименование</th>
                <th scope="col">Тип</th>
                <th scope="col">Кол-во</th>
                <th scope="col">Ед.</th>
                <th scope="col">Для чего</th>
              </tr>
            </thead>
            <tbody>
              {hardware.lines.map((line) => (
                <tr key={String(line.definitionId)}>
                  {/*
                    Колонка «Идентификатор» с ключом реестра
                    (`hw-shelf-support`) убрана из обычной таблицы
                    (PROMPT 62 §8, §11): поставщиков и артикулов здесь
                    нет — так и написано в подписи панели, — а ключ
                    движка человеку в цеху не говорит ничего. Он остаётся
                    в модели, в выгрузке и в подсказке строки, то есть
                    прослеживаемость сохранена (§16).
                  */}
                  <th scope="row" title={String(line.definitionId)}>
                    {line.name}
                  </th>
                  <td>{hardwareKindLabel(line.kind)}</td>
                  <td className={styles.num}>{line.quantity}</td>
                  <td>{hardwareUnitLabel(line.unit)}</td>
                  <td>
                    {/*
                      Источник — не текст, а переход: позиция фурнитуры
                      знает деталь, которая её потребовала (§25).

                      До PROMPT 62 подписью перехода был сам `PartId` —
                      `part:uuid/uuid/роль/uuid`, и четыре таких подряд
                      давали около двухсот знаков машинного текста в
                      строке «Полкодержатели». Теперь подпись — имя той
                      детали из деталировки, а сам идентификатор и
                      причина появления позиции остаются в подсказке
                      (§9 B+C, §16: прослеживаемость сохранена, но она
                      больше не первичный интерфейс).
                    */}
                    <ul className={styles.inlineList}>
                      {groupSources(line.sources, data.calculation.bom.parts).map((group) => (
                        <li key={group.key}>
                          {group.item === undefined ? (
                            <span title={`${group.source.ruleId} · ${group.source.reason}`}>
                              {group.label}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className={styles.link}
                              title={`${group.source.reason} · ${String(group.source.sourcePartId)}`}
                              onClick={() => {
                                actions.onSelectItem(group.item);
                                actions.onSection('parts');
                              }}
                            >
                              {group.label}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Источники позиции, сложенные по детали (PROMPT 62 §9).
 *
 * Шестнадцать полкодержателей на четырёх полках давали в колонке
 * «ПолкаПолкаПолкаПолка» — четыре одинаковых слова подряд. Складываются
 * они так же, как в выгрузке, и по тому же признаку: одна деталь
 * деталировки — одна строка.
 */
function groupSources(
  sources: readonly HardwareItem[],
  parts: readonly PartBOMItem[],
): readonly {
  key: string;
  label: string;
  source: HardwareItem;
  item: PartBOMItem | undefined;
}[] {
  const groups = new Map<string, { source: HardwareItem; item: PartBOMItem | undefined; count: number }>();
  for (const source of sources) {
    const item =
      source.sourcePartId === undefined ? undefined : itemOfSourcePart(parts, source.sourcePartId);
    const key = item?.id ?? source.reason;
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, { source, item, count: 1 });
    else existing.count += 1;
  }
  return [...groups].map(([key, group]) => ({
    key,
    label:
      group.count === 1
        ? (group.item?.name ?? group.source.reason)
        : `${group.item?.name ?? group.source.reason} ×${String(group.count)}`,
    source: group.source,
    item: group.item,
  }));
}

/** Сводная спецификация: детали, фурнитура, материалы, кромка (§26). */
export function BomSection({ data }: { readonly data: ProductionData }): React.JSX.Element {
  const bom = data.calculation.bom;

  return (
    <>
      <Panel
        id="production-bom-materials"
        title="Материалы"
        subtitle="Заготовки по материалам и толщинам — как их посчитал раскрой."
        wide
      >
        {bom.cutting.stocks.length === 0 ? (
          <EmptyState
            compact
            title="Заготовок не рассчитано"
            description="Раскрой не дал ни одного листа."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Материалы и заготовки</caption>
              <thead>
                <tr>
                  <th scope="col">Материал</th>
                  <th scope="col">Толщина</th>
                  <th scope="col">Формат</th>
                  <th scope="col">Листов</th>
                </tr>
              </thead>
              <tbody>
                {bom.cutting.stocks.map((stock) => (
                  <tr key={stock.stockId}>
                    <th scope="row">{stock.materialName}</th>
                    <td className={styles.num}>{formatMm(stock.thickness)}</td>
                    <td
                      className={styles.num}
                    >{`${formatMm(stock.stockLength)} × ${formatMm(stock.stockWidth)}`}</td>
                    <td className={styles.num}>{stock.stockQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        id="production-bom-edge"
        title="Кромка"
        subtitle="Длина выведена из реальных размеров деталей, а не оценена."
        wide
      >
        {bom.edgeBanding.length === 0 ? (
          <EmptyState
            compact
            title="Кромки нет"
            description="Ни одной стороне детали кромка не назначена."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Кромочный материал</caption>
              <thead>
                <tr>
                  <th scope="col">Материал</th>
                  <th scope="col">Толщина</th>
                  <th scope="col">Длина, м</th>
                  <th scope="col">Сторон</th>
                </tr>
              </thead>
              <tbody>
                {bom.edgeBanding.map((edge) => (
                  <tr key={edge.id}>
                    <th scope="row">{edge.materialName}</th>
                    <td className={styles.num}>{formatMm(edge.thickness)}</td>
                    <td className={styles.num}>{(edge.lengthMm / 1000).toFixed(2)}</td>
                    <td className={styles.num}>{edge.sideCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        id="production-bom-summary"
        title="Итого"
        subtitle="Те же числа, что уйдут в документ."
        wide
      >
        <StatusIndicator
          tone="neutral"
          label={`Позиций деталировки: ${String(bom.parts.length)}`}
          detail={`Деталей всего: ${String(bom.parts.reduce((sum, item) => sum + item.quantity, 0))} · фурнитуры: ${String(
            bom.hardware.lines.reduce((sum, line) => sum + line.quantity, 0),
          )} · операций присадки: ${String(bom.drilling.operationCount)} · листов: ${String(bom.cutting.stockCount)}`}
        />
      </Panel>
    </>
  );
}
