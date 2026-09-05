/**
 * Design system: единственная система интерфейса приложения (PROMPT 26 §1).
 *
 * ## Что здесь есть
 *
 * Примитивы, из которых собраны все экраны. Второй системы не
 * существует: если компонента здесь нет, его не заводят рядом — его
 * добавляют сюда.
 *
 * ## Чего здесь нет намеренно
 *
 * `Slider`, `Popover`, `Tabs`, `Checkbox`, `Card`, `Badge` и `Sheet`
 * задания §8 не реализованы, и это не забывчивость:
 *
 * * `Slider` — ни одна величина в приложении не задаётся приблизительно;
 *   ширина шкафа вводится числом, а не подтягивается ползунком.
 * * `Popover` — всплывающих слоёв в приложении два: подсказка у
 *   кнопки-иконки (в `IconButton`) и диалог. Третьего вида плавающего
 *   слоя нет, и заводить его «на будущее» — тот же мёртвый код, что и
 *   неиспользуемый движок анимации, найденный аудитом.
 * * `Tabs` — навигация между экранами и переключение вида холста — это
 *   выбор одного из немногих, и его выражает `SegmentedControl`. Две
 *   разных вкладочных механики на одном экране были бы именно тем
 *   расхождением, которое убирает этот этап.
 * * `Checkbox` — все переключатели в приложении применяются немедленно,
 *   это `Switch`. Форм с отложенным подтверждением нет.
 * * `Card` и `Badge` — карточка библиотеки это `Panel`, а плашка
 *   состояния это `StatusIndicator` в компактном виде. Отдельные
 *   компоненты были бы вторым именем для того же самого.
 * * `Sheet` — это `Dialog` на узком экране, одна и та же вещь.
 *
 * Каждый из них появится вместе со своим первым потребителем.
 */
export * from './tokens.js';

export { Button } from './Button.js';
export type { ButtonProps, ButtonVariant } from './Button.js';

export { IconButton } from './IconButton.js';
export type { IconButtonProps } from './IconButton.js';

export { Field } from './Field.js';
export type { FieldProps, FieldStatus } from './Field.js';

export { NumberInput, parseNumeric, formatNumeric, rangeMessage } from './NumberInput.js';
export type { NumberInputProps } from './NumberInput.js';

export { Select } from './Select.js';
export type { SelectProps, SelectOption } from './Select.js';

export { SegmentedControl } from './SegmentedControl.js';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl.js';

export { Switch } from './Switch.js';
export type { SwitchProps } from './Switch.js';

export { Panel, Divider } from './Panel.js';
export type { PanelProps, PanelTone } from './Panel.js';

export { StatusIndicator } from './StatusIndicator.js';
export type { StatusIndicatorProps, Tone } from './StatusIndicator.js';

export { EmptyState } from './EmptyState.js';
export type { EmptyStateProps, EmptyStateTone } from './EmptyState.js';

export { Dialog } from './Dialog.js';
export type { DialogProps } from './Dialog.js';
export { ErrorBoundary } from './ErrorBoundary.js';
export type { ErrorBoundaryProps } from './ErrorBoundary.js';
