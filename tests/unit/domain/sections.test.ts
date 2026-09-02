import { describe, expect, it } from 'vitest';
import { createSections, createUniformGrid } from '../../../src/domain/furniture/sections.js';
import { collectLeaves, isLeaf, isSplit } from '../../../src/domain/furniture/tree.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';

describe('createSections', () => {
  it('строит деление по X с N листьями-детьми', () => {
    const root = createSections(createSequentialIdFactory('t'), 4, 16);
    expect(isSplit(root)).toBe(true);
    expect(root.axis).toBe('x');
    expect(root.children).toHaveLength(4);
    expect(root.children.every((c) => isLeaf(c.node))).toBe(true);
  });

  it('дети равновесные (flex, вес 1) — равная ширина по умолчанию', () => {
    const root = createSections(createSequentialIdFactory('t'), 3, 16);
    expect(root.children.every((c) => c.size.mode === 'flex' && c.size.weight === 1)).toBe(true);
  });

  it('толщина перегородки берётся из аргумента', () => {
    const root = createSections(createSequentialIdFactory('t'), 2, 22);
    expect(root.divider.thickness).toBe(22);
    expect(root.divider.material).toBe('panel');
  });

  it('каждый вызов даёт уникальные id, даже при одинаковых параметрах', () => {
    const ids = createSequentialIdFactory('t');
    const a = createSections(ids, 2, 16);
    const b = createSections(ids, 2, 16);
    expect(a.id).not.toBe(b.id);
    expect(a.children[0]?.node.id).not.toBe(b.children[0]?.node.id);
  });
});

describe('createUniformGrid', () => {
  it('1×1 вырождается в лист без единого деления', () => {
    const root = createUniformGrid(createSequentialIdFactory('t'), 1, 1, 16, 16);
    expect(isLeaf(root)).toBe(true);
  });

  it('N×1 — чистое деление по Y, без вложенных X-делений', () => {
    const root = createUniformGrid(createSequentialIdFactory('t'), 3, 1, 16, 16);
    expect(isSplit(root) && root.axis === 'y').toBe(true);
    expect(isSplit(root) ? root.children.every((c) => isLeaf(c.node)) : false).toBe(true);
  });

  it('1×N — чистое деление по X, без обёртывающего Y-деления', () => {
    const root = createUniformGrid(createSequentialIdFactory('t'), 1, 4, 16, 16);
    expect(isSplit(root) && root.axis === 'x').toBe(true);
    expect(isSplit(root) ? root.children.every((c) => isLeaf(c.node)) : false).toBe(true);
  });

  it('rows×columns даёт rows строк по Y, каждая — columns листьев по X', () => {
    const root = createUniformGrid(createSequentialIdFactory('t'), 2, 3, 16, 16);
    expect(isSplit(root) && root.axis === 'y').toBe(true);
    if (!isSplit(root)) throw new Error('unreachable');
    expect(root.children).toHaveLength(2);
    for (const row of root.children) {
      expect(isSplit(row.node) && row.node.axis === 'x').toBe(true);
      if (isSplit(row.node)) expect(row.node.children).toHaveLength(3);
    }
  });

  it('число листьев всегда равно rows × columns', () => {
    for (const [rows, columns] of [
      [1, 1],
      [1, 5],
      [5, 1],
      [3, 4],
      [1, 1],
    ] as const) {
      const root = createUniformGrid(createSequentialIdFactory('t'), rows, columns, 16, 16);
      expect(collectLeaves(root)).toHaveLength(rows * columns);
    }
  });

  it('никакие два узла дерева не делят один id', () => {
    const root = createUniformGrid(createSequentialIdFactory('t'), 3, 4, 16, 16);
    const ids: string[] = [];
    const walk = (node: typeof root): void => {
      ids.push(node.id);
      if (isSplit(node)) node.children.forEach((c) => walk(c.node));
    };
    walk(root);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
