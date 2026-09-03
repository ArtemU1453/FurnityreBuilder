import { describe, expect, it } from 'vitest';
import { calculateHardware } from '../../../src/hardware/engine.js';
import { DEFAULT_HARDWARE_LIBRARY, HW_SLIDE } from '../../../src/hardware/registry.js';
import { fromJson, toJson } from '../../../src/persistence/serialization.js';
import { createDrawersLeaf } from '../../../src/domain/furniture/defaults.js';
import type { HardwareDefinition, Project } from '../../../src/domain/index.js';
import { makeProject } from './helpers.js';

/**
 * Спецификация не хранится (PROMPT 16 §22).
 *
 * Решение: `HardwareBOM` — производная величина и в файл проекта не
 * попадает. Сохранённая спецификация разошлась бы с моделью после первого
 * же изменения габарита, и тогда у количества стало бы два источника
 * истины — ровно то, что §2 запрещает. Тесты фиксируют обе стороны
 * решения: в файле количеств нет, а после загрузки расчёт даёт то же
 * самое, что до сохранения.
 */

const withDrawers = (count: number): Project =>
  makeProject((furniture, ids) => ({ ...furniture, root: createDrawersLeaf(ids, count) }));

describe('Test 31 (§22): в файле проекта количеств фурнитуры нет', () => {
  const json = toJson(withDrawers(3));

  it('ни спецификации, ни количества петель в сериализованном виде', () => {
    expect(json).not.toContain('hingeCount');
    expect(json).not.toContain('hardwareBom');
    expect(json).not.toContain('hw:slide');
  });

  it('встроенный реестр в файл тоже не пишется: определения живут в коде', () => {
    const parsed: unknown = JSON.parse(json);
    const project = (parsed as { project: { hardware: { items: Record<string, unknown> } } }).project;
    expect(Object.keys(project.hardware.items)).toHaveLength(0);
  });
});

describe('Test 32 (§22): миграция — старый файл считается новым движком', () => {
  it('проект с пустым реестром получает полную спецификацию', () => {
    const restored = fromJson(toJson(withDrawers(2))).project;
    expect(Object.keys(restored.hardware.items)).toHaveLength(0);
    const bom = calculateHardware(restored);
    expect(bom.lines.find((l) => l.definitionId === HW_SLIDE)?.quantity).toBe(4);
    expect(bom.errors).toHaveLength(0);
  });

  it('расчёт до и после сохранения совпадает побайтово', () => {
    const project = withDrawers(3);
    const restored = fromJson(toJson(project)).project;
    expect(JSON.stringify(calculateHardware(restored))).toBe(JSON.stringify(calculateHardware(project)));
  });
});

describe('Test 33 (§3): определение проекта перекрывает встроенное', () => {
  it('имя позиции берётся из реестра проекта, если оно там задано', () => {
    const custom: HardwareDefinition = {
      ...DEFAULT_HARDWARE_LIBRARY.items['hw-slide']!,
      name: 'Направляющая цеха №2',
    };
    const base = withDrawers(1);
    const project: Project = { ...base, hardware: { items: { [HW_SLIDE]: custom } } };
    const bom = calculateHardware(project);
    expect(bom.lines.find((l) => l.definitionId === HW_SLIDE)?.name).toBe('Направляющая цеха №2');
    expect(bom.errors).toHaveLength(0);
  });

  it('и такое определение переживает сериализацию', () => {
    const base = withDrawers(1);
    const project: Project = {
      ...base,
      hardware: { items: { [HW_SLIDE]: { ...DEFAULT_HARDWARE_LIBRARY.items['hw-slide']!, name: 'Своя' } } },
    };
    const restored = fromJson(toJson(project)).project;
    expect(restored.hardware.items['hw-slide']?.name).toBe('Своя');
    expect(restored.hardware.items['hw-slide']?.unit).toBe('pcs');
  });
});
