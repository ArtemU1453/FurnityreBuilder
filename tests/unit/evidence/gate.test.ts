import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canImplementProductionRule,
  deriveDecision,
  levelCeilingOf,
  qualifiesForUniversalRule,
  READINESS_REGISTRY,
  validateReadinessRegistry,
} from '../../../src/evidence/index.js';
import type { ProductionRuleReadiness } from '../../../src/evidence/index.js';
import { CARCASS_FASTENERS_PER_JOINT } from '../../../src/hardware/rules/fasteners.js';

/**
 * Ворота готовности производственных правил (PROMPT 65 §9).
 *
 * Эти тесты проверяют НЕ текст документов, а модель: решение выводится
 * из доказательств, и подделать его, не добавив доказательства нужного
 * уровня и области, нельзя. Именно это отличает ворота от таблички.
 */

/** Заготовка синтетического правила: дальше в каждом тесте меняется одно поле. */
function rule(patch: Partial<ProductionRuleReadiness>): ProductionRuleReadiness {
  return {
    id: 'PM-18',
    title: 'синтетическое правило',
    question: 'вопрос',
    applicability: 'applicable',
    unknownIds: [],
    evidence: [],
    contradictions: [],
    unresolvedVariables: [],
    declaredBlockers: [],
    nextEvidence: [],
    ...patch,
  };
}

const UNIVERSAL_PROOF = {
  id: 'PM-18/universal',
  statement: 'универсальное правило подтверждено производственным документом',
  sourceType: 'project-artifact-complete',
  scope: 'universal',
  status: 'confirmed',
  level: 'L3',
  document: 'docs/SOME.md',
} as const;

describe('ворота готовности: четыре текущих правила', () => {
  it.each(['PM-18', 'PM-17', 'PM-06', 'FR-04'] as const)('%s закрыто', (id) => {
    const readiness = canImplementProductionRule(id, READINESS_REGISTRY);
    expect(readiness.decision).toBe('BLOCKED');
    expect(readiness.allowed).toBe(false);
  });

  it('у каждого закрытого правила названа хотя бы одна причина', () => {
    for (const entry of READINESS_REGISTRY) {
      expect(canImplementProductionRule(entry.id, READINESS_REGISTRY).blockers.length).toBeGreaterThan(0);
    }
  });

  it('у каждого закрытого правила описан выход: минимально необходимое доказательство', () => {
    for (const entry of READINESS_REGISTRY) {
      const readiness = canImplementProductionRule(entry.id, READINESS_REGISTRY);
      expect(readiness.minimumMissingEvidence.length).toBeGreaterThan(0);
      for (const required of readiness.minimumMissingEvidence) {
        expect(required.necessity).toBe('minimum');
        expect(required.requirement.length).toBeGreaterThan(40);
      }
    }
  });

  it('реестр целостен: уровни не завышены, ссылки на месте, блокеры покрыты', () => {
    expect(validateReadinessRegistry(READINESS_REGISTRY)).toEqual([]);
  });

  it('идентификаторы читаемые, без UUID (§5)', () => {
    const ids = READINESS_REGISTRY.flatMap((entry) => [
      entry.id,
      ...entry.evidence.map((item) => item.id),
      ...entry.contradictions.map((item) => item.id),
      ...entry.nextEvidence.map((item) => item.id),
    ]);
    for (const id of ids) {
      expect(id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(id).toMatch(/^[A-Za-z0-9/-]+$/);
    }
  });
});

describe('что ворота НЕ пропускают', () => {
  it('подтверждённое на одном изделии не становится универсальным правилом (§9.5)', () => {
    const productSpecific = rule({
      evidence: [
        {
          id: 'PM-18/one-project',
          statement: 'в изделии A на стык приходится ровно 2 конфирмата',
          sourceType: 'project-artifact-complete',
          scope: 'single-project',
          status: 'confirmed',
          level: 'L3',
          document: 'docs/B3D_PM18_PM17_EVIDENCE.md',
        },
      ],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'второй заказ с другой длиной стыка, чтобы отличить правило от совпадения',
          wouldResolve: ['product-specific-evidence-only'],
          necessity: 'minimum',
        },
      ],
    });

    const { decision, blockers } = deriveDecision(productSpecific);
    expect(decision).toBe('BLOCKED');
    expect(blockers).toContain('product-specific-evidence-only');
    expect(qualifiesForUniversalRule(productSpecific.evidence[0]!)).toBe(false);
  });

  it('одного поискового пересказа недостаточно, даже если в нём есть число (§9.6)', () => {
    const snippetOnly = rule({
      evidence: [
        {
          id: 'PM-18/snippet',
          statement: 'страница называет ровно два конфирмата на стык',
          sourceType: 'search-index',
          scope: 'universal',
          // Даже «подтверждено» и «универсально» не спасают: потолок
          // уровня у поискового пересказа — L2.
          status: 'confirmed',
          level: 'L2',
          document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
        },
      ],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'дословный текст страницы либо схема сборки, приходящая с заказом',
          wouldResolve: ['source-level-l1-only'],
          necessity: 'minimum',
        },
      ],
    });

    const { decision, blockers } = deriveDecision(snippetOnly);
    expect(decision).toBe('BLOCKED');
    expect(blockers).toContain('source-level-l1-only');
  });

  it('поисковый пересказ нельзя объявить уровнем L3 или L4 (§9.6)', () => {
    expect(levelCeilingOf('search-index')).toBe('L2');
    const inflated = rule({
      evidence: [{ ...UNIVERSAL_PROOF, id: 'PM-18/inflated', sourceType: 'search-index' }],
    });
    expect(validateReadinessRegistry([inflated]).join('\n')).toContain('выше потолка');
  });

  it('противоречие не исчезает молча (§9.7)', () => {
    const withContradiction = rule({
      evidence: [
        UNIVERSAL_PROOF,
        {
          id: 'PM-18/other',
          statement: 'утверждение, опровергнутое первым',
          sourceType: 'search-index',
          scope: 'unresolved',
          status: 'contradicted',
          level: 'L1',
          document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
        },
      ],
      contradictions: [
        {
          id: 'PM-18/clash',
          between: ['PM-18/other', 'PM-18/universal'],
          classification: 'directly-disproved',
          summary: 'одно прямо опровергнуто другим',
          document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
        },
      ],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'дословный источник, который разрешит противоречие между этими двумя',
          wouldResolve: ['conflicting-evidence'],
          necessity: 'minimum',
        },
      ],
    });

    // Доказательство нужного уровня есть — и всё равно закрыто.
    expect(qualifiesForUniversalRule(UNIVERSAL_PROOF)).toBe(true);
    const { decision, blockers } = deriveDecision(withContradiction);
    expect(decision).toBe('BLOCKED');
    expect(blockers).toContain('conflicting-evidence');
  });

  it('один размерный случай не становится формулой (§9.8)', () => {
    const oneCase = rule({
      evidence: [
        {
          id: 'PM-18/single-case',
          statement: 'зазор 13 мм при проёме 596',
          sourceType: 'project-artifact-complete',
          scope: 'single-dimensional-case',
          status: 'confirmed',
          level: 'L3',
          document: 'docs/FR04_MULTI_DRAWER_EVIDENCE_ANALYSIS.md',
        },
      ],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'заказ с проёмом другой ширины — вторая размерная точка',
          wouldResolve: ['missing-dimensional-variation', 'product-specific-evidence-only'],
          necessity: 'minimum',
        },
      ],
    });

    const { decision, blockers } = deriveDecision(oneCase);
    expect(decision).toBe('BLOCKED');
    expect(blockers).toContain('missing-dimensional-variation');
  });

  it('закрытое правило без причины не проходит проверку реестра (§9.9)', () => {
    const noReason = rule({
      evidence: [
        {
          id: 'PM-18/unscoped',
          statement: 'производственный документ, область действия которого не установлена',
          sourceType: 'project-artifact-complete',
          scope: 'unresolved',
          status: 'confirmed',
          level: 'L3',
          document: 'docs/SOME.md',
        },
      ],
    });

    expect(deriveDecision(noReason).blockers).toEqual([]);
    const problems = validateReadinessRegistry([noReason]).join('\n');
    expect(problems).toContain('ни одна причина не названа');
    expect(problems).toContain('выхода из блокировки не описано');
  });

  it('блокер без минимально необходимого доказательства не проходит проверку (§9.10)', () => {
    const uncovered = rule({
      declaredBlockers: ['missing-algorithm'],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'что-нибудь ещё, что само по себе алгоритма не даёт',
          wouldResolve: ['insufficient-independent-cases'],
          necessity: 'minimum',
        },
      ],
    });
    expect(validateReadinessRegistry([uncovered]).join('\n')).toContain(
      'не покрыт ни одним минимально необходимым доказательством',
    );
  });

  it('противоречие, ссылающееся на несуществующее доказательство, не проходит', () => {
    const dangling = rule({
      contradictions: [
        {
          id: 'PM-18/dangling',
          between: ['PM-18/absent-one', 'PM-18/absent-two'],
          classification: 'unresolved',
          summary: 'ссылки в пустоту',
          document: 'docs/SOME.md',
        },
      ],
      nextEvidence: [
        {
          id: 'PM-18/next',
          requirement: 'источник, разрешающий это противоречие и дающий недостающий алгоритм',
          wouldResolve: ['conflicting-evidence', 'source-level-l1-only'],
          necessity: 'minimum',
        },
      ],
    });
    expect(validateReadinessRegistry([dangling]).join('\n')).toContain('которого нет у правила');
  });
});

describe('что ворота пропускают', () => {
  it('подтверждённое универсальное доказательство без противоречий открывает правило', () => {
    const allowed = rule({ evidence: [UNIVERSAL_PROOF] });
    expect(deriveDecision(allowed)).toEqual({ decision: 'ALLOWED', blockers: [] });
    expect(validateReadinessRegistry([allowed])).toEqual([]);
  });

  it('неприменимое правило не закрыто и не открыто', () => {
    const notApplicable = rule({ applicability: 'not-applicable' });
    expect(deriveDecision(notApplicable)).toEqual({ decision: 'NOT_APPLICABLE', blockers: [] });
    expect(canImplementProductionRule('PM-18', [notApplicable]).allowed).toBe(false);
  });
});

describe('ворота сверяются с настоящим состоянием кода', () => {
  /*
    Без этой связки ворота остались бы отдельным документом: реестр
    говорил бы «закрыто», а расчёт спокойно выдавал бы количество.
    Здесь проверяется, что состояние реестра и состояние кода — одно.
  */
  it('PM-18 закрыт — и количество крепежа на стык в коде не задано', () => {
    expect(canImplementProductionRule('PM-18', READINESS_REGISTRY).decision).toBe('BLOCKED');
    expect(CARCASS_FASTENERS_PER_JOINT).toBeUndefined();
  });

  it('каждая запись реестра ссылается на существующий документ репозитория', () => {
    for (const entry of READINESS_REGISTRY) {
      const documents = new Set([
        ...entry.evidence.map((item) => item.document),
        ...entry.contradictions.map((item) => item.document),
      ]);
      for (const document of documents) {
        expect(() => readFileSync(document, 'utf8')).not.toThrow();
      }
    }
  });

  it('каждый названный неизвестный факт есть в docs/UNKNOWNS.json', () => {
    const registry = JSON.parse(readFileSync('docs/UNKNOWNS.json', 'utf8')) as {
      unknowns: { id: string }[];
    };
    const known = new Set(registry.unknowns.map((entry) => entry.id));
    for (const entry of READINESS_REGISTRY) {
      for (const id of entry.unknownIds) expect(known).toContain(id);
    }
  });
});
