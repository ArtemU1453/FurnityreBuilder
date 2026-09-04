import { useId, useState } from 'react';
import { Field } from './Field.js';
import type { FieldStatus } from './Field.js';
import styles from './NumberInput.module.css';

/**
 * Числовое поле с единицей измерения (PROMPT 26 §9).
 *
 * ## Зачем компонент
 *
 * До этого этапа числовых полей в приложении было двадцать три, и каждое
 * было написано заново: где-то единица стояла в подписи («Ширина, мм»),
 * где-то её не было вовсе; где-то `min` был, где-то нет; пустое поле в
 * одном месте означало ноль, в другом — «не трогать». Пользователь не
 * может знать таких различий, а поддерживать их невозможно.
 *
 * ## Компонент НЕ меняет точность домена
 *
 * Он разбирает то, что ввёл человек, и отдаёт число как есть. Ни
 * округления, ни «подтягивания» к шагу, ни зажима в диапазон здесь нет:
 * округление — правило домена (`roundMm`), а зажим превратил бы «я
 * опечатался» в «приложение молча подставило другое значение». Выход за
 * диапазон показывается сообщением, значение при этом доходит до домена,
 * и уже он объясняет, что не так.
 *
 * ## Черновик, а не значение
 *
 * Пока поле в фокусе, показывается ровно то, что набирает человек:
 * пустая строка, «1,», «-» — промежуточные состояния, из которых число
 * ещё не получилось. Если бы поле само переписывало ввод на разобранное
 * значение, стереть последнюю цифру было бы невозможно. При потере
 * фокуса черновик отбрасывается и снова показывается значение модели —
 * поэтому расхождение между полем и моделью не переживает потерю фокуса.
 */

export interface NumberInputProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly onChange: (value: number) => void;
  /** Единица измерения. Показывается в поле, а не в подписи. */
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Знаков после запятой при показе. На значение в модели не влияет. */
  readonly precision?: number;
  readonly disabled?: boolean;
  /** Пояснение под полем, когда всё в порядке. */
  readonly hint?: string;
  /** Сообщение важнее вычисленного: домен знает больше, чем диапазон. */
  readonly message?: string;
  readonly status?: FieldStatus;
  readonly id?: string;
}

/** Разбор ввода: запятая — тоже десятичный разделитель. */
export function parseNumeric(raw: string): number | undefined {
  const text = raw.trim().replace(',', '.');
  if (text === '' || text === '-' || text === '.' || text === '-.') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Показ значения: без хвостовых нулей, если точность не задана. */
export function formatNumeric(value: number | undefined, precision: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '';
  return precision === undefined ? String(value) : value.toFixed(precision);
}

/** Что не так со значением — или `undefined`, если всё в порядке. */
export function rangeMessage(
  value: number | undefined,
  min: number | undefined,
  max: number | undefined,
  unit: string | undefined,
): string | undefined {
  const suffix = unit === undefined ? '' : ` ${unit}`;
  if (value === undefined) return 'Введите число.';
  if (min !== undefined && value < min) return `Не меньше ${String(min)}${suffix}.`;
  if (max !== undefined && value > max) return `Не больше ${String(max)}${suffix}.`;
  return undefined;
}

export function NumberInput(props: NumberInputProps): React.JSX.Element {
  const unitId = useId();
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const shown = draft ?? formatNumeric(props.value, props.precision);
  const parsed = draft === undefined ? props.value : parseNumeric(draft);
  const problem = props.message ?? rangeMessage(parsed, props.min, props.max, props.unit);
  const status: FieldStatus = props.status ?? (problem === undefined ? 'default' : 'error');

  return (
    <Field
      label={props.label}
      status={status}
      {...(problem === undefined ? {} : { message: problem })}
      {...(props.hint === undefined ? {} : { hint: props.hint })}
    >
      {({ id, describedBy, invalid }) => (
        <div className={styles.control} data-invalid={invalid || undefined}>
          <input
            id={props.id ?? id}
            className={styles.input}
            type="number"
            inputMode="decimal"
            /*
              Клавиша подтверждения на экранной клавиатуре подписана
              «Готово», а не «Ввод»: формы здесь нет, отправлять нечего
              (PROMPT 28 §25).
            */
            enterKeyHint="done"
            value={shown}
            disabled={props.disabled ?? false}
            aria-invalid={invalid}
            aria-describedby={
              [props.unit === undefined ? undefined : unitId, describedBy]
                .filter(Boolean)
                .join(' ')
                .trim() || undefined
            }
            {...(props.min === undefined ? {} : { min: props.min })}
            {...(props.max === undefined ? {} : { max: props.max })}
            {...(props.step === undefined ? {} : { step: props.step })}
            onFocus={() => {
              setDraft(formatNumeric(props.value, props.precision));
            }}
            onBlur={() => {
              setDraft(undefined);
            }}
            onKeyDown={(event) => {
              // Enter завершает ввод: поле теряет фокус, черновик
              // отбрасывается, экранная клавиатура убирается и открывает
              // изделие. Без этого «Готово» на телефоне не делает ничего,
              // и поле остаётся под клавиатурой (§25).
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            onChange={(event) => {
              // Вставка из буфера приходит сюда же обычным change: отдельной
              // обработки `paste` не нужно, и она бы дублировала разбор.
              const next = event.target.value;
              setDraft(next);
              const value = parseNumeric(next);
              if (value !== undefined) props.onChange(value);
            }}
          />
          {props.unit === undefined ? null : (
            <span className={styles.unit} id={unitId}>
              {props.unit}
            </span>
          )}
        </div>
      )}
    </Field>
  );
}
