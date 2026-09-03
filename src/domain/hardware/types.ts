import type { HardwareId, PartId } from '../ids.js';

/**
 * Категория фурнитуры (PROMPT 16 §3).
 *
 * Список закрыт и содержит только то, что уже встречается в конструкции
 * изделия: петля и её крепёж, направляющая, полкодержатель, крепёж задней
 * стенки и корпуса, ручка с крепежом, push-механизм, штанга с фланцем,
 * ножка и клипса цоколя. Каталог производителей на этом этапе не заводится
 * (PROMPT 16 §3) — категория говорит, ЧТО это, а не чьё оно.
 *
 * `hinge-fastener` и `handle-fastener` отделены от самой петли и ручки
 * намеренно (§7, §12): это разные позиции спецификации, и смешивать их
 * в одну строку значило бы потерять и то и другое количество.
 */
export type HardwareKind =
  | 'confirmat'
  | 'eccentric'
  | 'dowel'
  | 'shelf-support'
  | 'hinge'
  | 'hinge-fastener'
  | 'slide'
  | 'handle'
  | 'handle-fastener'
  | 'push-latch'
  | 'rod'
  | 'rod-flange'
  | 'leg'
  | 'plinth-clip'
  | 'back-nail';

/** Единица измерения позиции спецификации. */
export type HardwareUnit = 'pcs' | 'pair' | 'set';

/**
 * ОПИСАНИЕ позиции фурнитуры в реестре — справочные данные, а не результат
 * расчёта: количества у него нет и быть не должно.
 *
 * До PROMPT 16 тип назывался `HardwareItem`, хотя количества не содержал
 * никогда. Имя `HardwareItem` освобождено под ПРОИЗВОДНУЮ сущность
 * (`src/hardware/types.ts`, PROMPT 16 §4) — ту, у которой есть и
 * количество, и источник. Так же, как `Material` описывает материал, а
 * `Part` — конкретную деталь из него.
 */
export interface HardwareDefinition {
  readonly id: HardwareId;
  readonly kind: HardwareKind;
  readonly name: string;
  readonly unit: HardwareUnit;
  /** Свободные характеристики: «7×50», «угол 110°», «длина 450». */
  readonly spec: Readonly<Record<string, string | number>>;
}

/** Реестр фурнитуры — тот же Registry-паттерн, что и `MaterialLibrary`. */
export interface HardwareLibrary {
  readonly items: Readonly<Record<string, HardwareDefinition>>;
}

/**
 * Строка итоговой спецификации.
 * `sourcePartIds` даёт трассируемость: по любой позиции видно, какие детали
 * её породили, и её можно подсветить на схеме.
 */
export interface HardwareLine {
  readonly hardwareId: HardwareId;
  readonly quantity: number;
  readonly sourcePartIds: readonly PartId[];
}

export const EMPTY_HARDWARE_LIBRARY: HardwareLibrary = { items: {} };
