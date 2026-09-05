import { describe, expect, it } from 'vitest';
import {
  DeserializationError,
  deserializeDocument,
  fromJson,
  toJson,
} from '../../../src/persistence/serialization.js';
import { MigrationError } from '../../../src/persistence/migrations/index.js';
import { MAX_IMPORT_BYTES, checkImportSize } from '../../../src/persistence/transfer.js';
import { SCHEMA_VERSION } from '../../../src/domain/index.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  createFurnitureInstance,
  createRectangularRoom,
} from '../../../src/domain/room/defaults.js';
import { FIXTURES, productionOf, run } from '../integration/fixtures.js';
import type { FixtureName } from '../integration/fixtures.js';

/**
 * Устойчивость хранения (PROMPT 30 §10).
 *
 * Проверяется не «разбор работает», а то, что негодные данные не
 * превращаются в тихую потерю: неизвестное поле, отсутствующее
 * необязательное, битый JSON, дубль идентификатора и ссылка в никуда.
 *
 * Молчаливая потеря данных — худший из возможных исходов: файл
 * открывается, проект выглядит целым, а часть работы исчезла.
 */

const NAMES = Object.keys(FIXTURES) as FixtureName[];

const documentOf = (name: FixtureName): Record<string, unknown> =>
  JSON.parse(toJson(FIXTURES[name]())) as Record<string, unknown>;

describe.each(NAMES)('круговой путь: «%s»', (name) => {
  it('проект и расчёт переживают сохранение и загрузку', () => {
    const project = FIXTURES[name]();
    const restored = fromJson(toJson(project)).project;
    expect(restored).toEqual(project);
    expect(productionOf(restored).bom).toEqual(productionOf(project).bom);
  });

  it('версия схемы записана и совпадает с текущей', () => {
    expect(documentOf(name).schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe('негодный вход', () => {
  it('не-JSON объясняется, а не роняет приложение', () => {
    expect(() => fromJson('это не json')).toThrow(DeserializationError);
  });

  it('пустой и примитивный вход отвергается', () => {
    for (const raw of [null, 42, 'строка', true, []]) {
      expect(() => deserializeDocument(raw)).toThrow(DeserializationError);
    }
  });

  it('документ без версии схемы отвергается', () => {
    const document = documentOf('carcass');
    delete document.schemaVersion;
    expect(() => deserializeDocument(document)).toThrow(DeserializationError);
  });

  it('версия из будущего отвергается, а не разбирается наугад', () => {
    // Файл новее приложения содержит поля, о которых оно не знает.
    // Открыть его «как получится» значило бы потерять их при сохранении.
    const document = documentOf('carcass');
    document.schemaVersion = SCHEMA_VERSION + 5;
    let error: unknown;
    try {
      deserializeDocument(document);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MigrationError);
    // Сообщение называет обе версии: иначе непонятно, что делать.
    expect((error as MigrationError).message).toContain(String(SCHEMA_VERSION + 5));
    expect((error as MigrationError).from).toBe(SCHEMA_VERSION + 5);
  });

  it('битая структура проекта отвергается с объяснением', () => {
    const document = documentOf('carcass');
    (document.project as Record<string, unknown>).furniture = 'не массив';
    let error: unknown;
    try {
      deserializeDocument(document);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DeserializationError);
    // Подробности не теряются: без них починить файл невозможно.
    expect((error as DeserializationError).details.length).toBeGreaterThan(0);
  });

  it('отрицательный габарит в файле отвергается схемой', () => {
    const document = documentOf('carcass');
    const project = document.project as { furniture: { dimensions: Record<string, number> }[] };
    project.furniture[0]!.dimensions.width = -100;
    expect(() => deserializeDocument(document)).toThrow(DeserializationError);
  });

  it('неизвестное поле не ломает разбор и не подменяет известные', () => {
    const document = documentOf('shelves');
    (document.project as Record<string, unknown>).неизвестноеПоле = { что: 'угодно' };
    const restored = deserializeDocument(document).project;
    // Проект разобран целиком: изделие, дерево и материалы на месте.
    expect(restored.furniture).toHaveLength(1);
    expect(restored.materials.items).not.toEqual({});
  });

  it('отсутствующее необязательное поле восстанавливается значением по умолчанию', () => {
    const document = documentOf('carcass');
    const project = document.project as { room?: unknown; settings: Record<string, unknown> };
    delete project.room;
    const restored = deserializeDocument(document).project;
    expect(restored.room).toBeUndefined();
    expect(restored.settings.construction).toBeDefined();
  });
});

describe('ссылочная целостность', () => {
  it('экземпляр мебели без projectId получает проект, в котором лежит', () => {
    // Файл, сохранённый до библиотеки, знал только furnitureId. Это не
    // догадка: другого проекта в таком файле не было.
    const ids = createSequentialIdFactory('h');
    const base = FIXTURES.carcass();
    const room = createRectangularRoom({ ids, width: 4000, depth: 3000 });
    const instance = createFurnitureInstance(ids, base.id, base.furniture[0]!);
    const project = run(base, [
      { type: 'SetRoom', room },
      { type: 'AddFurnitureInstance', instance },
    ]);

    const document = JSON.parse(toJson(project)) as Record<string, unknown>;
    const stored = (document.project as { room: { furnitureInstances: Record<string, unknown>[] } })
      .room;
    // Поле в схеме необязательное: именно так выглядит файл, сохранённый
    // до появления библиотеки проектов.
    delete stored.furnitureInstances[0]!.projectId;

    const restored = deserializeDocument(document).project;
    expect(restored.room?.furnitureInstances[0]?.projectId).toBe(project.id);
  });

  it('ссылка на несуществующий материал не теряется молча', () => {
    // Битую ссылку ловит диагностика расчёта, а не разбор: файл остаётся
    // открываемым, и пользователь видит, что именно не так.
    const project = FIXTURES.carcass();
    const broken = {
      ...project,
      materials: {
        ...project.materials,
        assignment: { ...project.materials.assignment, side: 'нет-такого' },
      },
    };
    const restored = fromJson(toJson(broken as never)).project;
    expect(restored.materials.assignment.side).toBe('нет-такого');

    const production = productionOf(restored);
    const problems = [
      ...production.bom.errors,
      ...production.bom.warnings,
      ...production.geometry.flatMap((entry) => entry.result.diagnostics),
    ];
    expect(problems.some((issue) => issue.code.includes('MATERIAL_NOT_FOUND'))).toBe(true);
  });

  /**
   * Размер файла проверяется ДО чтения (PROMPT 31 §17).
   *
   * Не «слишком большой проект», а не-проект: выбранный по ошибке образ
   * диска прочитался бы через `file.text()` целиком в память вкладки, и
   * вместо сообщения об ошибке человек получил бы зависшую страницу.
   */
  describe('предел размера импортируемого файла (§17)', () => {
    it('обычный проект проходит с большим запасом', () => {
      const bytes = new TextEncoder().encode(toJson(FIXTURES.complex())).length;
      expect(bytes).toBeLessThan(MAX_IMPORT_BYTES);
      expect(checkImportSize(bytes)).toBeUndefined();
    });

    it('файл ровно по пределу ещё читается', () => {
      expect(checkImportSize(MAX_IMPORT_BYTES)).toBeUndefined();
    });

    it('файл сверх предела отклоняется с объяснением, а не молча', () => {
      const rejected = checkImportSize(MAX_IMPORT_BYTES + 1);
      expect(rejected?.status).toBe('INVALID');
      expect(rejected?.message).toContain('слишком велик');
      expect(rejected?.details).toContain('МБ');
    });

    it('нечисловой размер тоже отклоняется: неизвестный размер не повод читать', () => {
      expect(checkImportSize(Number.NaN)?.status).toBe('INVALID');
      expect(checkImportSize(Number.POSITIVE_INFINITY)?.status).toBe('INVALID');
    });

    it('пустой файл по размеру проходит — его отклонит уже разбор', () => {
      expect(checkImportSize(0)).toBeUndefined();
      expect(() => fromJson('')).toThrow(DeserializationError);
    });
  });

  it('двойное сохранение и загрузка ничего не накапливает', () => {
    const project = FIXTURES.complex();
    const once = fromJson(toJson(project)).project;
    const twice = fromJson(toJson(once)).project;
    expect(twice).toEqual(once);
    expect(toJson(twice)).toBe(toJson(once));
  });
});
