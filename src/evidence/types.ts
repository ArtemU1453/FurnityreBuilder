/**
 * Модель готовности производственного правила к реализации (PROMPT 65 §3).
 *
 * ## Зачем этот слой существует
 *
 * В этом проекте уже дважды случалось одно и то же: правдоподобное число
 * из одного заказа или из пересказа страницы выглядело как правило. Оба
 * раза его останавливал не механизм, а разбор вручную — и разбор этот
 * жил в документах, которые никто не обязан читать.
 *
 * Здесь то же решение записано так, чтобы его можно было ПРОВЕРИТЬ:
 * решение «реализовывать нельзя» не хранится как слово, а **выводится**
 * из перечисленных доказательств (`deriveDecision`). Чтобы правило стало
 * `ALLOWED`, нельзя просто исправить строчку: придётся добавить
 * доказательство нужного уровня и области и снять противоречия.
 *
 * ## Чего этот слой НЕ делает
 *
 * Он ничего не считает для производства. Он не знает ни про деталь, ни
 * про стык, ни про отверстие. Он отвечает ровно на один вопрос:
 * **почему это правило до сих пор не реализовано** — и отвечает
 * структурой, а не прозой.
 */

/** Правило производства, готовность которого отслеживается. Читаемый идентификатор (§5). */
export type ProductionRuleId = 'PM-18' | 'PM-17' | 'PM-06' | 'FR-04';

/**
 * Тип источника доказательства (§3.1).
 *
 * Порядок здесь не алфавитный, а по убыванию силы: от дословного
 * официального документа до «неизвестно».
 */
export type EvidenceSourceType =
  /** Дословный официальный документ производителя мебели. */
  | 'official-direct'
  /** Производственный артефакт целиком: спецификация заказа, файл проекта. */
  | 'project-artifact-complete'
  /** Часть артефакта: одна страница, один лист, один фрагмент. */
  | 'project-artifact-partial'
  /** Пересказ поискового индекса: дословного текста страницы нет. */
  | 'search-index'
  /** Вывод из других данных, а не наблюдение. */
  | 'inference'
  /** Наш собственный эскиз или умолчание, выбранное нами. */
  | 'design-sketch'
  /** Происхождение установить не удалось. */
  | 'unknown';

/** Область действия доказательства (§3.2). */
export type EvidenceScope =
  | 'universal'
  | 'product-specific'
  | 'single-dimensional-case'
  | 'single-project'
  | 'unresolved';

/** Состояние доказательства (§3.3). */
export type EvidenceStatus =
  | 'confirmed'
  | 'supported'
  | 'partially-confirmed'
  | 'contradicted'
  | 'indistinguishable'
  | 'unknown';

/**
 * Уровень доказательства. Шкала заведена не здесь: она описана в
 * `docs/HARDWARE_REFERENCE_EVIDENCE_VERIFICATION.md` §1 и в разборах
 * официальных страниц. Этот слой её только применяет.
 */
export type EvidenceLevel = 'L1' | 'L2' | 'L3' | 'L4';

/** Решение о реализации (§3.4). */
export type ImplementationDecision = 'ALLOWED' | 'BLOCKED' | 'NOT_APPLICABLE';

/**
 * Причина блокировки (§3.5). Не проза: по коду можно проверить
 * программно, почему правило закрыто.
 */
export type BlockerCode =
  /** Независимых случаев слишком мало, чтобы отличить правило от совпадения. */
  | 'insufficient-independent-cases'
  /** Всё, что есть, — пересказ индекса или вывод: числового правила не обосновывает. */
  | 'source-level-l1-only'
  /** Доказательства противоречат друг другу, и противоречие не разрешено. */
  | 'conflicting-evidence'
  /** Есть один размерный случай; без второго формула не отличима от соседних. */
  | 'missing-dimensional-variation'
  /** Не хватает параметра самой модели фурнитуры (размера, координаты). */
  | 'missing-model-parameter'
  /** Неизвестен сам алгоритм: что во что превращается. */
  | 'missing-algorithm'
  /** Все доказательства принадлежат одному изделию или проекту. */
  | 'product-specific-evidence-only';

/** Классификация противоречия (§6). */
export type ContradictionClass =
  /** A. Одно доказательство прямо опровергнуто другим. */
  | 'directly-disproved'
  /** B. Доказательства про разные области и сравнению не подлежат. */
  | 'incompatible-scopes'
  /** C. Сравнить нечем: не хватает данных, чтобы понять, о том ли речь. */
  | 'insufficient-information'
  /** D. Противоречие настоящее и не разрешено. */
  | 'unresolved';

/** Одно доказательство. Идентификатор читаемый и детерминированный (§5). */
export interface EvidenceItem {
  /** `<ПРАВИЛО>/<короткое-имя>`, например `PM-18/b3d-two-per-joint`. */
  readonly id: string;
  /** Что именно наблюдалось. Одно утверждение, а не пересказ документа. */
  readonly statement: string;
  readonly sourceType: EvidenceSourceType;
  readonly scope: EvidenceScope;
  readonly status: EvidenceStatus;
  /** Не выше потолка своего типа источника — это проверяет `validateReadinessRegistry`. */
  readonly level: EvidenceLevel;
  /** Документ репозитория, где разбор приведён целиком. */
  readonly document: string;
}

/** Зафиксированное противоречие между двумя доказательствами (§6). */
export interface Contradiction {
  readonly id: string;
  /** Идентификаторы доказательств того же правила. */
  readonly between: readonly [string, string];
  readonly classification: ContradictionClass;
  readonly summary: string;
  readonly document: string;
}

/**
 * Требуемое доказательство (§8).
 *
 * `necessity` отделяет «минимально необходимое, чтобы снять блокировку»
 * от «полезно бы иметь». Без этого разделения §8 вырождается в список
 * пожеланий.
 */
export interface RequiredEvidence {
  readonly id: string;
  /** Что именно достать. Конкретно: «второй заказ с ящиками другой глубины», а не «больше источников». */
  readonly requirement: string;
  /** Какие именно блокировки это снимет. */
  readonly wouldResolve: readonly BlockerCode[];
  readonly necessity: 'minimum' | 'useful';
}

/** Применимость правила: `NOT_APPLICABLE` — правило к этому продукту не относится. */
export type RuleApplicability = 'applicable' | 'not-applicable';

/** Готовность одного производственного правила (§5: правило → доказательства → решение → блокер). */
export interface ProductionRuleReadiness {
  readonly id: ProductionRuleId;
  readonly title: string;
  /** Какое именно УНИВЕРСАЛЬНОЕ правило стоит на кону. */
  readonly question: string;
  readonly applicability: RuleApplicability;
  /** Записи `docs/UNKNOWNS.json`, которые закрылись бы вместе с этим правилом. */
  readonly unknownIds: readonly string[];
  readonly evidence: readonly EvidenceItem[];
  readonly contradictions: readonly Contradiction[];
  /** Величины, без которых алгоритма нет. Человеческий текст, но список, а не абзац. */
  readonly unresolvedVariables: readonly string[];
  /** Блокеры, объявленные разбором. Выведенные добавляются сверху в `deriveDecision`. */
  readonly declaredBlockers: readonly BlockerCode[];
  readonly nextEvidence: readonly RequiredEvidence[];
}

/** Ответ ворот (§7). */
export interface ImplementationReadiness {
  readonly ruleId: ProductionRuleId;
  readonly allowed: boolean;
  readonly decision: ImplementationDecision;
  readonly blockers: readonly BlockerCode[];
  /** Только `necessity: 'minimum'`: что достать, чтобы сдвинуть статус. */
  readonly minimumMissingEvidence: readonly RequiredEvidence[];
}
