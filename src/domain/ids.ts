/**
 * Идентификаторы доменных сущностей.
 *
 * Брендированные строки: `NodeId` нельзя случайно передать туда, где ждут
 * `MaterialId`, хотя во время выполнения это обычные строки и они сериализуются
 * в JSON без потерь.
 */

declare const brand: unique symbol;

export type Id<T extends string> = string & { readonly [brand]: T };

export type ProjectId = Id<'Project'>;
export type FurnitureId = Id<'Furniture'>;
export type NodeId = Id<'Node'>;
export type PartId = Id<'Part'>;
export type MaterialId = Id<'Material'>;
export type HardwareId = Id<'Hardware'>;
export type WallId = Id<'Wall'>;

/**
 * Идентификаторы планировщика (PROMPT 24).
 *
 * `RoomId` появился, потому что комната стала самостоятельным объектом с
 * именем; до этого `Room` был безымянной парой «стены + высота потолка».
 * `InstanceId` намеренно НЕ равен `FurnitureId`: один и тот же шкаф может
 * стоять в комнате дважды, и у двух экземпляров обязаны быть разные
 * идентификаторы при одной и той же мебели.
 */
export type RoomId = Id<'Room'>;
export type InstanceId = Id<'Instance'>;
export type OpeningId = Id<'Opening'>;
export type ObstacleId = Id<'Obstacle'>;

/** Присваивает бренд существующей строке (десериализация, литералы в тестах). */
export function asId<T extends string>(value: string): Id<T> {
  return value as Id<T>;
}

/**
 * Источник новых идентификаторов.
 *
 * Инъекция, а не прямой вызов `crypto.randomUUID()`, по двум причинам:
 * домен обязан работать без браузерных API, а тесты должны получать
 * воспроизводимые значения без подмены глобальных объектов.
 */
export interface IdFactory {
  next<T extends string>(): Id<T>;
}

/** Идентификаторы на основе Web Crypto (доступно и в Node ≥ 19, и в браузере). */
export function createRandomIdFactory(): IdFactory {
  return {
    next<T extends string>(): Id<T> {
      return asId<T>(globalThis.crypto.randomUUID());
    },
  };
}

/** Детерминированный источник для тестов и снапшотов. */
export function createSequentialIdFactory(prefix = 'id'): IdFactory {
  let n = 0;
  return {
    next<T extends string>(): Id<T> {
      n += 1;
      return asId<T>(`${prefix}-${String(n)}`);
    },
  };
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/** Проверка формата: используется валидацией ссылочной целостности. */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
