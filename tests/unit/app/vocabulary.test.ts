import { describe, expect, it } from 'vitest';
import {
  HARDWARE_KIND_LABELS,
  OBSTACLE_KIND_LABELS,
  PART_ROLE_LABELS,
  hardwareKindLabel,
  obstacleKindLabel,
  partRoleLabel,
  stageList,
} from '../../../src/app/vocabulary.js';

/**
 * Словарь показа (PROMPT 58 §5, §20 E).
 *
 * Дефект `FR-12`: в русском интерфейсе стояло «Деталь · back» — сырое
 * значение `PartRole`. Сплошной обход видимого текста добавил такие же
 * `HardwareKind` в спецификации фурнитуры и `ObstacleKind` в списке
 * препятствий.
 *
 * Полнота словарей держится типами: `Record<Enum, string>` не даст
 * собраться, пока для нового значения нет подписи. Здесь проверяется
 * второе свойство — что подписи не остались латиницей и не пусты.
 */

const LATIN = /[A-Za-z]/;

/** Отраслевые обозначения, которые по-русски так и пишут. */
const KEPT_AS_IS = new Set(['push-to-open', 'push-механизм']);

describe('словарь показа', () => {
  it('ни одна подпись роли детали не осталась латиницей', () => {
    for (const [role, label] of Object.entries(PART_ROLE_LABELS)) {
      expect(label, `роль «${role}» без подписи`).not.toBe('');
      if (KEPT_AS_IS.has(label)) continue;
      expect(label, `роль «${role}» подписана латиницей: ${label}`).not.toMatch(LATIN);
    }
  });

  it('ни одна подпись вида фурнитуры не осталась латиницей', () => {
    for (const [kind, label] of Object.entries(HARDWARE_KIND_LABELS)) {
      expect(label, `вид «${kind}» без подписи`).not.toBe('');
      if (KEPT_AS_IS.has(label)) continue;
      expect(label, `вид «${kind}» подписан латиницей: ${label}`).not.toMatch(LATIN);
    }
  });

  it('ни одна подпись препятствия не осталась латиницей', () => {
    for (const [kind, label] of Object.entries(OBSTACLE_KIND_LABELS)) {
      expect(label).not.toBe('');
      expect(label, `препятствие «${kind}» подписано латиницей: ${label}`).not.toMatch(LATIN);
    }
  });

  it('подписи различают роли, а не сливают их в одно слово', () => {
    const labels = Object.values(PART_ROLE_LABELS);
    expect(new Set(labels).size, 'две роли получили одну подпись').toBe(labels.length);
  });

  it('наблюдённое «back» больше не показывается как есть', () => {
    expect(partRoleLabel('back')).toBe('задняя стенка');
    expect(partRoleLabel('shelf-adjustable')).toBe('полка съёмная');
    expect(hardwareKindLabel('confirmat')).toBe('конфирмат');
    expect(obstacleKindLabel('radiator')).toBe('радиатор');
  });

  it('нереализованные этапы называются последствием, а не именем этапа', () => {
    expect(stageList(['edges', 'drilling'])).toBe('кромка и присадка');
    expect(stageList(['edges'])).toBe('кромка');
    expect(stageList([])).toBe('');
  });

  it('незнакомое имя этапа возвращается как есть, а не пропадает молча', () => {
    expect(stageList(['edges', 'нечто'])).toBe('кромка и нечто');
  });
});
