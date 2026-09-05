import { useMemo, useState } from 'react';
import { formatMm } from '../../../domain/index.js';
import { Button, EmptyState, Field, Panel, Select } from '../../../design-system/index.js';
import { PartDrawing } from '../../../render/index.js';
import { buildPartDrawing, operationsOfItem } from '../../../export/index.js';
import type { PartBOMItem } from '../../../bom/index.js';
import {
  DEFAULT_PART_FILTER,
  materialOptions,
  partRows,
  placementSummary,
  typeOptions,
  visibleRows,
} from '../../production/index.js';
import type { PartFilter, PartSortKey } from '../../production/index.js';
import type { ProductionActions, ProductionData, SelectionState } from './types.js';
import styles from './ProductionSections.module.css';

/**
 * Детали, чертежи и присадка (PROMPT 29 §6–§18).
 *
 * ## Ни одной величины не считается здесь
 *
 * Размеры, количества, координаты отверстий и правила приходят готовыми
 * из `ProductionCalculationResult`. Раздел выбирает, что показать, и в
 * каком порядке — это и есть его работа.
 *
 * ## Группировка не переизобретается
 *
 * Две одинаковые боковины приходят сюда ОДНОЙ строкой с количеством 2:
 * так их сгруппировал `ProductionBOM`. Разгруппировывать их в интерфейсе
 * значило бы показывать не то, что уйдёт в цех (§7).
 */

const SORT_OPTIONS: readonly { readonly value: PartSortKey; readonly label: string }[] = [
  { value: 'index', label: 'По номеру' },
  { value: 'name', label: 'По наименованию' },
  { value: 'type', label: 'По типу' },
  { value: 'size', label: 'По размеру' },
  { value: 'material', label: 'По материалу' },
  { value: 'quantity', label: 'По количеству' },
];

export interface PartsSectionProps {
  readonly data: ProductionData;
  readonly selection: SelectionState;
  readonly actions: ProductionActions;
}

export function PartsSection({ data, selection, actions }: PartsSectionProps): React.JSX.Element {
  const [filter, setFilter] = useState<PartFilter>(DEFAULT_PART_FILTER);
  const items = data.calculation.bom.parts;
  const rows = useMemo(() => partRows(items), [items]);
  const shown = useMemo(() => visibleRows(rows, filter), [rows, filter]);
  const materials = useMemo(() => materialOptions(items), [items]);
  const types = useMemo(() => typeOptions(items), [items]);

  return (
    <>
      <Panel
        id="production-parts"
        title="Детали"
        subtitle="Позиции деталировки: одинаковые детали — одна строка с количеством, как в спецификации."
        wide
      >
        <div className={styles.filters}>
          <Field label="Поиск">
            {({ id }) => (
              <input
                id={id}
                className={styles.search}
                type="search"
                value={filter.query}
                placeholder="имя, номер, материал, размер"
                onChange={(event) => {
                  setFilter({ ...filter, query: event.target.value });
                }}
              />
            )}
          </Field>
          <Select
            label="Материал"
            value={filter.materialId ?? ''}
            options={[
              { value: '', label: 'Любой' },
              ...materials.map((m) => ({ value: String(m.id), label: m.name })),
            ]}
            onChange={(value) => {
              setFilter({
                ...filter,
                materialId: value === '' ? undefined : (value as PartFilter['materialId']),
              });
            }}
          />
          <Select
            label="Тип"
            value={filter.partType ?? ''}
            options={[{ value: '', label: 'Любой' }, ...types.map((t) => ({ value: t, label: t }))]}
            onChange={(value) => {
              setFilter({
                ...filter,
                partType: value === '' ? undefined : (value as PartFilter['partType']),
              });
            }}
          />
          <Select
            label="Порядок"
            value={filter.sort}
            options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            onChange={(value) => {
              setFilter({ ...filter, sort: value as PartSortKey });
            }}
          />
        </div>

        <p className={styles.count} role="status" aria-live="polite">
          {`Показано ${String(shown.length)} из ${String(rows.length)} позиций · всего деталей ${String(
            items.reduce((sum, item) => sum + item.quantity, 0),
          )}`}
        </p>

        {shown.length === 0 ? (
          <EmptyState
            compact
            title="Ничего не найдено"
            description="Ни одна позиция деталировки не подходит под условия отбора."
          />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.caption}>Позиции деталировки</caption>
              <thead>
                <tr>
                  <th scope="col">№</th>
                  <th scope="col">Наименование</th>
                  <th scope="col">Тип</th>
                  <th scope="col">Кол-во</th>
                  <th scope="col">Длина</th>
                  <th scope="col">Ширина</th>
                  <th scope="col">Толщина</th>
                  <th scope="col">Материал</th>
                  <th scope="col">Кромка</th>
                  <th scope="col">Текстура</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const active = row.item.id === selection.selectedItem?.id;
                  return (
                    <tr key={row.item.id} data-active={active ? '' : undefined}>
                      <th scope="row">
                        <button
                          type="button"
                          className={styles.rowButton}
                          aria-pressed={active}
                          onClick={() => {
                            actions.onSelectItem(active ? undefined : row.item);
                          }}
                        >
                          {row.index}
                        </button>
                      </th>
                      <td>{row.item.name}</td>
                      <td>{row.item.partType}</td>
                      <td className={styles.num}>{row.item.quantity}</td>
                      <td className={styles.num}>{formatMm(row.item.length)}</td>
                      <td className={styles.num}>{formatMm(row.item.width)}</td>
                      <td className={styles.num}>{formatMm(row.item.thickness)}</td>
                      <td>{row.item.materialName}</td>
                      <td>{row.edge}</td>
                      <td>{row.item.grainDirection}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <PartDetails data={data} selection={selection} actions={actions} />
    </>
  );
}

/** Подробности выбранной детали и её цепочка источников (§8, §9, §32). */
function PartDetails({ selection, actions }: PartsSectionProps): React.JSX.Element {
  const item = selection.selectedItem;
  const trace = selection.trace;

  if (item === undefined || trace === undefined) {
    return (
      <Panel id="production-part-details" title="Выбранная деталь" wide>
        <EmptyState
          compact
          title="Деталь не выбрана"
          description="Нажмите номер позиции в списке — здесь появятся её размеры, источник, присадка и раскрой."
        />
      </Panel>
    );
  }

  return (
    <Panel
      id="production-part-details"
      title={item.name}
      subtitle={`${formatMm(item.length)} × ${formatMm(item.width)} × ${formatMm(item.thickness)} мм · ${item.materialName} · ${String(item.quantity)} шт`}
      wide
      actions={
        <div className={styles.actions}>
          <Button
            disabled={trace.sourceParts[0] === undefined}
            onClick={() => {
              const partId = trace.sourceParts[0];
              if (partId !== undefined) actions.onShowIn3d(partId);
            }}
          >
            Показать в 3D
          </Button>
          <Button
            disabled={trace.origins[0] === undefined}
            onClick={() => {
              const origin = trace.origins[0];
              if (origin !== undefined) actions.onShowInEditor(origin.nodeId);
            }}
          >
            Открыть в конструкторе
          </Button>
        </div>
      }
    >
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>Тип</dt>
          <dd>{item.partType}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Раздел</dt>
          <dd>{item.category}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Текстура</dt>
          <dd>{item.grainDirection}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Отверстий</dt>
          <dd>{trace.drilling.length}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Фурнитуры</dt>
          <dd>{trace.hardware.length}</dd>
        </div>
        <div className={styles.fact}>
          <dt>Листы раскроя</dt>
          <dd>{trace.sheets.length === 0 ? 'не размещена' : trace.sheets.join(', ')}</dd>
        </div>
      </dl>

      <h3 className={styles.subheading}>Источник</h3>
      {trace.origins.length === 0 ? (
        <p className={styles.note}>
          Узел модели у этой позиции не записан, поэтому показать её место в изделии нельзя. Это не
          догадка интерфейса, а отсутствующая связь в данных.
        </p>
      ) : (
        <ul className={styles.list}>
          {trace.origins.map((origin) => (
            <li key={origin.nodeId}>
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  actions.onShowInEditor(origin.nodeId);
                }}
              >
                {origin.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 className={styles.subheading}>Физические детали</h3>
      <ul className={styles.list}>
        {trace.sourceParts.map((partId) => (
          <li key={partId}>
            <button
              type="button"
              className={styles.link}
              onClick={() => {
                actions.onShowIn3d(partId);
              }}
            >
              {partId}
            </button>
          </li>
        ))}
      </ul>

      {trace.placements.length === 0 ? null : (
        <>
          <h3 className={styles.subheading}>Раскрой</h3>
          <ul className={styles.list}>
            {trace.placements.map((placement) => (
              <li key={placement.id}>{placementSummary(placement)}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** Чертёж выбранной детали (§10–§14). */
export function DrawingsSection({
  data,
  selection,
}: {
  readonly data: ProductionData;
  readonly selection: SelectionState;
}): React.JSX.Element {
  const [hole, setHole] = useState<string | undefined>(undefined);
  const item = selection.selectedItem;

  const view = useMemo(
    () =>
      item === undefined
        ? undefined
        : buildPartDrawing(
            item,
            operationsOfItem(item, data.calculation.drilling.byProductionPart),
          ),
    [item, data.calculation.drilling.byProductionPart],
  );

  if (item === undefined || view === undefined) {
    return (
      <Panel id="production-drawing" title="Чертёж" wide>
        <EmptyState
          compact
          title="Деталь не выбрана"
          description="Выберите позицию в разделе «Детали» — здесь появится её чертёж с размерами и отверстиями."
        />
      </Panel>
    );
  }

  return (
    <Panel id="production-drawing" title={view.title} wide>
      <PartDrawing
        view={view}
        {...(hole === undefined ? {} : { selectedHoleId: hole })}
        onSelectHole={setHole}
      />

      <h3 className={styles.subheading}>Отверстия</h3>
      {view.holes.length === 0 && view.edgeHoles.length === 0 ? (
        <p className={styles.note}>
          Для этой детали отверстий не рассчитано. Чертёж показывает контур, кромку и габарит — то,
          что рассчитано на самом деле.
        </p>
      ) : (
        <ul className={styles.list}>
          {view.holes.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={styles.link}
                aria-pressed={entry.id === hole}
                onClick={() => {
                  setHole(entry.id === hole ? undefined : entry.id);
                }}
              >
                {`${entry.label} · X ${formatMm(entry.x)} · Y ${formatMm(entry.y)}`}
              </button>
            </li>
          ))}
          {view.edgeHoles.map((entry) => (
            <li key={entry.id}>
              {`${entry.faceLabel}: ${entry.label} · X ${formatMm(entry.x)} · Y ${formatMm(entry.y)}`}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Присадка: операции, конфликты и правила, по которым они получены (§15–§18). */
export function DrillingSection({
  data,
  selection,
  actions,
}: PartsSectionProps): React.JSX.Element {
  const plan = data.calculation.drilling;
  const item = selection.selectedItem;
  const operations =
    item === undefined ? plan.operations : operationsOfItem(item, plan.byProductionPart);
  const partsById = new Map(data.calculation.bom.parts.map((entry) => [entry.id, entry]));

  return (
    <Panel
      id="production-drilling"
      title="Присадка"
      subtitle={
        item === undefined
          ? 'Все операции проекта. Выберите деталь, чтобы оставить только её.'
          : `Операции детали «${item.name}».`
      }
      wide
      actions={
        item === undefined ? undefined : (
          <Button
            onClick={() => {
              actions.onSelectItem(undefined);
            }}
          >
            Все детали
          </Button>
        )
      }
    >
      <p className={styles.count}>
        {`Операций: ${String(operations.length)} · деталей с присадкой: ${String(plan.byProductionPart.size)}`}
      </p>

      {/* Конфликты и ограничения не прячутся (§17). */}
      {plan.errors.length === 0 ? null : (
        <ul className={styles.problems} data-tone="danger">
          {plan.errors.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}
      {plan.warnings.length === 0 ? null : (
        <ul className={styles.problems} data-tone="warning">
          {plan.warnings.map((issue) => (
            <li key={issue.code + issue.message}>{issue.message}</li>
          ))}
        </ul>
      )}

      {operations.length === 0 ? (
        <EmptyState
          compact
          title="Операций не рассчитано"
          description="Ни одно правило присадки не подтверждено референсом, поэтому координат отверстий не существует. Что именно неизвестно — в списке выше и в разделе «Сводка»."
        />
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.caption}>Операции сверления</caption>
            <thead>
              <tr>
                <th scope="col">Операция</th>
                <th scope="col">Деталь</th>
                <th scope="col">Грань</th>
                <th scope="col">X</th>
                <th scope="col">Y</th>
                <th scope="col">Ø</th>
                <th scope="col">Глубина</th>
                <th scope="col">Тип</th>
                <th scope="col">Назначение</th>
                <th scope="col">Правило</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => (
                <tr key={operation.id}>
                  <th scope="row">{operation.id}</th>
                  <td>
                    {partsById.get(operation.productionPartId)?.name ?? operation.productionPartId}
                  </td>
                  <td>{operation.face}</td>
                  <td className={styles.num}>{formatMm(operation.x)}</td>
                  <td className={styles.num}>{formatMm(operation.y)}</td>
                  <td className={styles.num}>{formatMm(operation.diameter)}</td>
                  <td className={styles.num}>{formatMm(operation.depth)}</td>
                  <td>{operation.through}</td>
                  <td>{operation.purpose}</td>
                  {/* Правило и причина — начало трассируемости (§18). */}
                  <td title={operation.reason}>{operation.ruleId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export type { PartBOMItem };
