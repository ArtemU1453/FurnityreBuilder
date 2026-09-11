import type {
  BlockerCode,
  EvidenceItem,
  EvidenceLevel,
  EvidenceSourceType,
  ImplementationDecision,
  ImplementationReadiness,
  ProductionRuleId,
  ProductionRuleReadiness,
  RequiredEvidence,
} from './types.js';

/**
 * Ворота готовности (PROMPT 65 §7).
 *
 * Решение не хранится — оно ВЫВОДИТСЯ. Это единственная причина, по
 * которой воротам вообще можно верить: строку `decision: 'ALLOWED'`
 * можно было бы просто написать, а доказательство уровня L3 с областью
 * `universal` — нельзя.
 *
 * Ворота ничего не считают для производства и ничего оттуда не читают.
 */

const LEVEL_RANK: Readonly<Record<EvidenceLevel, number>> = { L1: 1, L2: 2, L3: 3, L4: 4 };

/**
 * Потолок уровня по типу источника.
 *
 * Опускаться ниже потолка можно: официальная страница, подтверждающая
 * только существование возможности, — это L2, а не L4. Подниматься выше
 * нельзя: пересказ индекса не становится производственным документом
 * оттого, что в нём написано конкретное число.
 */
const LEVEL_CEILING: Readonly<Record<EvidenceSourceType, EvidenceLevel>> = {
  'official-direct': 'L4',
  'project-artifact-complete': 'L3',
  'project-artifact-partial': 'L3',
  // L2 — ровно «страница подтверждает существование возможности»; больше
  // из поискового пересказа не выжать.
  'search-index': 'L2',
  inference: 'L1',
  'design-sketch': 'L1',
  unknown: 'L1',
};

export const levelRank = (level: EvidenceLevel): number => LEVEL_RANK[level];

export const levelCeilingOf = (source: EvidenceSourceType): EvidenceLevel => LEVEL_CEILING[source];

/**
 * Доказательство, которого достаточно для универсального правила.
 *
 * Три условия одновременно, и ни одно нельзя ослабить:
 * подтверждено, универсально по области, не ниже L3. Уровень L3 — это
 * производственный артефакт; L1 и L2 сюда не проходят по определению
 * (§2: «L2/L1 → NOT sufficient for numerical production rules»).
 */
export const qualifiesForUniversalRule = (item: EvidenceItem): boolean =>
  item.status === 'confirmed' && item.scope === 'universal' && levelRank(item.level) >= 3;

/** Блокеры, которые выводятся из самих доказательств, а не объявляются. */
function derivedBlockers(rule: ProductionRuleReadiness): BlockerCode[] {
  const found: BlockerCode[] = [];

  // Противоречие не исчезает оттого, что о нём не написали в блокерах.
  const unsettled = rule.contradictions.some(
    (c) => c.classification === 'directly-disproved' || c.classification === 'unresolved',
  );
  if (unsettled) found.push('conflicting-evidence');

  if (rule.evidence.some(qualifiesForUniversalRule)) return found;

  // Ниже — случаи, когда универсального доказательства нет вовсе.
  const strongest = rule.evidence.reduce((max, item) => Math.max(max, levelRank(item.level)), 0);
  if (strongest <= 2) found.push('source-level-l1-only');

  const hasUniversalScope = rule.evidence.some((item) => item.scope === 'universal');
  const onlyOneProduct =
    !hasUniversalScope &&
    rule.evidence.some(
      (item) => item.scope === 'single-project' || item.scope === 'product-specific',
    );
  if (onlyOneProduct) found.push('product-specific-evidence-only');

  if (rule.evidence.some((item) => item.scope === 'single-dimensional-case')) {
    found.push('missing-dimensional-variation');
  }

  return found;
}

/**
 * Решение и полный набор блокеров.
 *
 * `ALLOWED` требует всего сразу: правило применимо, есть подходящее
 * доказательство и НЕ ОСТАЛОСЬ ни одного блокера — ни объявленного, ни
 * выведенного.
 */
export function deriveDecision(rule: ProductionRuleReadiness): {
  readonly decision: ImplementationDecision;
  readonly blockers: readonly BlockerCode[];
} {
  if (rule.applicability === 'not-applicable') {
    return { decision: 'NOT_APPLICABLE', blockers: [] };
  }

  const blockers = [...new Set([...rule.declaredBlockers, ...derivedBlockers(rule)])];
  const qualifying = rule.evidence.some(qualifiesForUniversalRule);
  const decision: ImplementationDecision =
    blockers.length === 0 && qualifying ? 'ALLOWED' : 'BLOCKED';
  return { decision, blockers };
}

/**
 * Ворота: можно ли реализовывать правило (§7).
 *
 * Возвращает не только «нет», но и почему, и что именно достать. Ответ
 * «нельзя» без второго и третьего бесполезен: он не подсказывает выхода.
 */
export function canImplementProductionRule(
  ruleId: ProductionRuleId,
  registry: readonly ProductionRuleReadiness[],
): ImplementationReadiness {
  const rule = registry.find((entry) => entry.id === ruleId);
  if (rule === undefined) {
    throw new Error(`Правило ${ruleId} отсутствует в реестре готовности.`);
  }

  const { decision, blockers } = deriveDecision(rule);
  const minimumMissingEvidence: readonly RequiredEvidence[] = rule.nextEvidence.filter(
    (item) => item.necessity === 'minimum',
  );

  return {
    ruleId,
    allowed: decision === 'ALLOWED',
    decision,
    blockers,
    minimumMissingEvidence,
  };
}

/**
 * Проверка целостности реестра.
 *
 * Возвращает список нарушений; пустой список — реестр корректен.
 * Проверяется то, без чего ворота превратились бы в украшение:
 * нельзя завысить уровень доказательства, нельзя сослаться на
 * несуществующее доказательство, нельзя заблокировать правило без
 * причины и без выхода.
 */
export function validateReadinessRegistry(
  registry: readonly ProductionRuleReadiness[],
): readonly string[] {
  const problems: string[] = [];
  const seenRules = new Set<string>();
  const seenEvidence = new Set<string>();

  for (const rule of registry) {
    if (seenRules.has(rule.id)) problems.push(`Правило ${rule.id} встречается дважды.`);
    seenRules.add(rule.id);

    const ids = new Set<string>();
    for (const item of rule.evidence) {
      if (seenEvidence.has(item.id)) problems.push(`Доказательство ${item.id} встречается дважды.`);
      seenEvidence.add(item.id);
      ids.add(item.id);

      if (!item.id.startsWith(`${rule.id}/`)) {
        problems.push(`Доказательство ${item.id} не начинается с идентификатора правила ${rule.id}.`);
      }
      if (levelRank(item.level) > levelRank(levelCeilingOf(item.sourceType))) {
        problems.push(
          `Доказательство ${item.id}: уровень ${item.level} выше потолка ${levelCeilingOf(item.sourceType)} для источника «${item.sourceType}».`,
        );
      }
      if (item.document.length === 0) {
        problems.push(`Доказательство ${item.id} не ссылается ни на один документ.`);
      }
    }

    for (const contradiction of rule.contradictions) {
      for (const ref of contradiction.between) {
        if (!ids.has(ref)) {
          problems.push(
            `Противоречие ${contradiction.id} ссылается на доказательство ${ref}, которого нет у правила ${rule.id}.`,
          );
        }
      }
    }

    const { decision, blockers } = deriveDecision(rule);

    if (decision === 'BLOCKED') {
      if (blockers.length === 0) {
        problems.push(`Правило ${rule.id} закрыто, но ни одна причина не названа.`);
      }
      const minimum = rule.nextEvidence.filter((item) => item.necessity === 'minimum');
      if (minimum.length === 0) {
        problems.push(`Правило ${rule.id} закрыто, но выхода из блокировки не описано.`);
      }
      const covered = new Set(minimum.flatMap((item) => item.wouldResolve));
      for (const blocker of blockers) {
        if (!covered.has(blocker)) {
          problems.push(
            `Правило ${rule.id}: блокер «${blocker}» не покрыт ни одним минимально необходимым доказательством.`,
          );
        }
      }
    }

    if (decision === 'ALLOWED' && !rule.evidence.some(qualifiesForUniversalRule)) {
      problems.push(`Правило ${rule.id} открыто без подходящего доказательства.`);
    }
  }

  return problems;
}
