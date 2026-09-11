/**
 * Ворота готовности производственных правил (PROMPT 65).
 *
 * Слой отвечает на один вопрос: **почему это правило не реализовано** —
 * и отвечает структурой, которую можно проверить тестом, а не прозой в
 * документе. Ничего для производства он не считает и ни из одного
 * расчётного слоя не читает.
 *
 * Правило для будущих участников — `docs/PRODUCTION_RULE_EVIDENCE_GATE.md`.
 */
export {
  canImplementProductionRule,
  deriveDecision,
  levelCeilingOf,
  levelRank,
  qualifiesForUniversalRule,
  validateReadinessRegistry,
} from './gate.js';
export { READINESS_REGISTRY } from './registry.js';
export type {
  BlockerCode,
  Contradiction,
  ContradictionClass,
  EvidenceItem,
  EvidenceLevel,
  EvidenceScope,
  EvidenceSourceType,
  EvidenceStatus,
  ImplementationDecision,
  ImplementationReadiness,
  ProductionRuleId,
  ProductionRuleReadiness,
  RequiredEvidence,
  RuleApplicability,
} from './types.js';
