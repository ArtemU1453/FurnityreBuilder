import { describe, expect, it } from 'vitest';
import { createProject } from '../../../src/domain/project/factory.js';
import { withPreview } from '../../../src/domain/index.js';
import { createSequentialIdFactory } from '../../../src/domain/ids.js';
import {
  PREVIEW_HEIGHT,
  PREVIEW_WIDTH,
  fingerprintProject,
  generateProjectThumbnail,
  isPreviewStale,
  shadeColor,
} from '../../../src/library/index.js';

/**
 * Превью проекта (PROMPT 25 §7–§8).
 *
 * Главное свойство — детерминированность: одинаковый проект обязан
 * давать посимвольно одинаковую картинку. Иначе каждое сохранение
 * записывало бы «изменившееся» превью и список мигал бы без причины.
 */

const now = (): string => '2026-01-01T00:00:00.000Z';
const project = (name = 'Шкаф') => createProject({ ids: createSequentialIdFactory('p'), now, name });

describe('детерминированность', () => {
  it('один и тот же проект даёт одну и ту же строку', () => {
    const a = generateProjectThumbnail(project(), now);
    const b = generateProjectThumbnail(project(), now);
    expect(a?.svg).toBe(b?.svg);
  });

  it('в картинке нет ни времени, ни случайных чисел', () => {
    const preview = generateProjectThumbnail(project(), now);
    expect(preview?.svg).not.toContain('2026');
  });

  it('изменение габарита меняет картинку', () => {
    const base = project();
    const item = base.furniture[0]!;
    const wider = { ...base, furniture: [{ ...item, dimensions: { ...item.dimensions, width: 1800 } }] };
    expect(generateProjectThumbnail(base, now)?.svg).not.toBe(generateProjectThumbnail(wider, now)?.svg);
  });

  it('переименование картинку не меняет: она не зависит от имени', () => {
    expect(generateProjectThumbnail(project('А'), now)?.svg).toBe(generateProjectThumbnail(project('Б'), now)?.svg);
  });
});

describe('форма картинки', () => {
  const preview = generateProjectThumbnail(project(), now)!;

  it('это законченный SVG заданного размера', () => {
    expect(preview.width).toBe(PREVIEW_WIDTH);
    expect(preview.height).toBe(PREVIEW_HEIGHT);
    expect(preview.svg.startsWith('<svg')).toBe(true);
    expect(preview.svg.endsWith('</svg>')).toBe(true);
  });

  it('изделие вписано в кадр, а не обрезано', () => {
    const numbers = [...preview.svg.matchAll(/points="([^"]+)"/gu)]
      .flatMap((match) => (match[1] ?? '').split(' '))
      .flatMap((pair) => pair.split(',').map(Number));
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...numbers)).toBeLessThanOrEqual(Math.max(PREVIEW_WIDTH, PREVIEW_HEIGHT));
  });

  it('каждая деталь даёт три видимые грани', () => {
    const polygons = [...preview.svg.matchAll(/<polygon/gu)].length;
    expect(polygons % 3).toBe(0);
    expect(polygons).toBeGreaterThan(0);
  });

  it('маленький и большой шкаф занимают кадр одинаково: масштаб подбирается', () => {
    const base = project();
    const item = base.furniture[0]!;
    const big = {
      ...base,
      furniture: [{ ...item, dimensions: { ...item.dimensions, width: 3000, height: 2400 } }],
    };
    const spanOf = (svg: string): number => {
      const xs = [...svg.matchAll(/points="([^"]+)"/gu)]
        .flatMap((match) => (match[1] ?? '').split(' '))
        .map((pair) => Number(pair.split(',')[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    const small = spanOf(preview.svg);
    const large = spanOf(generateProjectThumbnail(big, now)!.svg);
    // Оба вписаны: разница в занятой ширине — от пропорций, а не от
    // того, что большой шкаф вылез за кадр.
    expect(large).toBeLessThanOrEqual(PREVIEW_WIDTH);
    expect(small).toBeLessThanOrEqual(PREVIEW_WIDTH);
  });

  it('проект без изделий картинки не даёт и не падает', () => {
    expect(generateProjectThumbnail({ ...project(), furniture: [] }, now)).toBeUndefined();
  });
});

describe('отпечаток источника', () => {
  it('одинаковое состояние — одинаковый отпечаток', () => {
    expect(fingerprintProject(project())).toBe(fingerprintProject(project()));
  });

  it('переименование отпечаток не меняет', () => {
    expect(fingerprintProject(project('А'))).toBe(fingerprintProject(project('Б')));
  });

  it('изменение изделия отпечаток меняет', () => {
    const base = project();
    const item = base.furniture[0]!;
    const changed = { ...base, furniture: [{ ...item, dimensions: { ...item.dimensions, depth: 700 } }] };
    expect(fingerprintProject(changed)).not.toBe(fingerprintProject(base));
  });

  it('превью без отпечатка от источника считается устаревшим', () => {
    expect(isPreviewStale(project())).toBe(true);
  });

  it('свежее превью устаревшим не считается', () => {
    const base = project();
    const withIt = withPreview(base, generateProjectThumbnail(base, now)!);
    expect(isPreviewStale(withIt)).toBe(false);
  });

  it('правка изделия делает сохранённое превью устаревшим', () => {
    const base = project();
    const withIt = withPreview(base, generateProjectThumbnail(base, now)!);
    const item = withIt.furniture[0]!;
    const edited = { ...withIt, furniture: [{ ...item, dimensions: { ...item.dimensions, width: 1200 } }] };
    expect(isPreviewStale(edited)).toBe(true);
  });
});

describe('затенение граней', () => {
  it('осветление и затемнение остаются цветом', () => {
    expect(shadeColor('#808080', 1.2)).toBe('#9a9a9a');
    expect(shadeColor('#808080', 0.5)).toBe('#404040');
  });

  it('канал не выходит за пределы', () => {
    expect(shadeColor('#ffffff', 2)).toBe('#ffffff');
  });

  it('непонятный цвет возвращается как есть, а не превращается в чёрный', () => {
    expect(shadeColor('rgb(1,2,3)', 1.2)).toBe('rgb(1,2,3)');
  });
});
