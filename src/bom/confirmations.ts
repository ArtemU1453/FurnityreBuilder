import { HARDWARE_RULES } from '../hardware/index.js';
import { DRILLING_RULES } from '../drilling/index.js';
import type { ConfirmationCategory, ConfirmationItem, ConfirmationSeverity } from './types.js';

/**
 * Централизованный список неподтверждённых правил (PROMPT 19 §18).
 *
 * ## Почему он собирается, а не пишется руками
 *
 * Правила фурнитуры и присадки уже объявляют свой статус и идентификатор
 * неизвестного (`HardwareRule.status`/`unknownId`, `DrillingRule` — то же
 * самое). Список строится из этих объявлений, поэтому не может отстать от
 * кода: подтвердили правило, поменяли статус — строка исчезла из
 * спецификации сама.
 *
 * Руками задаются только те ограничения, у которых нет объекта-правила:
 * параметры раскроя, умолчания кромки и неподтверждённая конструкция
 * короба ящика. Каждое из них — константа в конкретном файле, и файл
 * назван в поле `source`.
 *
 * ## Зачем это в спецификации
 *
 * Лист с количеством, полученным по выдуманному правилу, выглядит ровно
 * так же, как лист с подтверждённым. Разницу видно только на
 * производстве — и там она стоит партии деталей. Поэтому спецификация
 * несёт этот список рядом с цифрами, а не прячет его.
 */

/** Ограничения, у которых нет объекта-правила: константы в коде. */
const STATIC_CONFIRMATIONS: readonly ConfirmationItem[] = [
  {
    id: 'T-CUT-01',
    category: 'CUTTING',
    rule: 'Ширина пропила',
    source: 'src/domain/cutting/types.ts (DEFAULT_KERF)',
    impact: 'Раскладка использует временное техническое значение 4 мм: число листов и процент использования могут отличаться от цеховых.',
    // Листы посчитаны и пригодны: расходится может только их число.
    severity: 'informational',
  },
  {
    id: 'T-CUT-02',
    category: 'CUTTING',
    rule: 'База процента использования листа',
    source: 'src/production/layout.ts',
    impact: 'Процент считается от полной площади листа; если референс считает от рабочей области, цифра будет выше.',
    severity: 'informational',
  },
  {
    id: 'T-CUT-03',
    category: 'CUTTING',
    rule: 'Обрезная кромка листа по сторонам',
    source: 'src/production/stock.ts',
    impact: 'Применяется одно значение ко всем четырём сторонам: рабочая область может отличаться от цеховой.',
    severity: 'informational',
  },
  {
    id: 'T-EDG-02',
    category: 'EDGE',
    rule: 'Правило назначения кромки по сторонам детали',
    source: 'src/domain/materials/defaults.ts (DEFAULT_EDGE)',
    impact: 'Метраж кромки считается по умолчанию «2 мм спереди, 0.4 по бокам»: при другом правиле изменится длина кромки в спецификации.',
    severity: 'informational',
  },
  {
    id: 'T-EDG-03',
    category: 'EDGE',
    rule: 'Вычитается ли толщина кромки из размера заготовки',
    source: 'src/domain/materials/defaults.ts (DEFAULT_EDGE_SIZING_POLICY)',
    impact: 'По умолчанию не вычитается: при обратном правиле изменятся размеры раскроя каждой оклеиваемой детали.',
    severity: 'informational',
  },
  {
    id: 'T-DRW-02',
    category: 'CONSTRUCTION',
    rule: 'Конструкция короба ящика',
    source: 'src/geometry/stages/fill.ts',
    impact: 'Деталей короба (боковины, задник, дно) в спецификации нет вовсе: геометрия их не строит.',
    // Деталей НЕТ в результате: их нечего пилить и нечем собирать.
    severity: 'action-required',
  },
  {
    id: 'T-DRILL-05',
    category: 'DRILLING',
    rule: 'Минимальные технологические расстояния присадки',
    source: 'src/drilling/validate.ts (DRILLING_CLEARANCES)',
    impact: 'Проверки отступов от края и между отверстиями не выполняются: близко расположенные отверстия не будут отмечены.',
    severity: 'informational',
  },
];

/** Статус правила → тяжесть для человека. Разбор — `docs/FR20_PRODUCTION_DEFAULT_ANALYSIS.md`. */
function severityOfRuleStatus(status: string): ConfirmationSeverity {
  return status === 'needs-confirmation' ? 'action-required' : 'informational';
}

function fromRules(
  rules: readonly { id: string; title: string; status: string; unknownId?: string }[],
  category: ConfirmationCategory,
  sourceDir: string,
): ConfirmationItem[] {
  const items: ConfirmationItem[] = [];
  for (const rule of rules) {
    if (rule.status !== 'needs-confirmation' && rule.status !== 'ambiguous') continue;
    if (rule.unknownId === undefined) continue;
    items.push({
      id: rule.unknownId,
      category,
      rule: rule.title,
      source: `${sourceDir}/${rule.id}`,
      impact:
        rule.status === 'needs-confirmation'
          ? 'Правило не выдаёт результата: позиций по нему в спецификации нет.'
          : 'Результат посчитан, но часть характеристик позиции не подтверждена.',
      /*
        Тяжесть выводится из СТАТУСА правила, а не назначается вручную
        (PROMPT 63 §7). `needs-confirmation` означает, что правило не
        выдало результата — позиции нет в спецификации, и купить её
        нельзя. `ambiguous` означает, что результат посчитан, а
        неподтверждённой осталась характеристика.
      */
      severity: severityOfRuleStatus(rule.status),
    });
  }
  return items;
}

/**
 * Все неподтверждённые правила проекта.
 *
 * Одно неизвестное может блокировать несколько правил (`T-HW-03` — и
 * крепёж корпуса, и крепёж задней стенки), поэтому строки различаются
 * полем `rule`, а не только идентификатором: технологу нужно видеть, ЧТО
 * именно не посчитано, а не только чего не хватает.
 */
export function collectConfirmations(): readonly ConfirmationItem[] {
  const items = [
    ...fromRules(HARDWARE_RULES, 'HARDWARE', 'src/hardware/rules'),
    ...fromRules(DRILLING_RULES, 'DRILLING', 'src/drilling/rules'),
    ...STATIC_CONFIRMATIONS,
  ];
  items.sort((a, b) => {
    const byCategory = a.category.localeCompare(b.category);
    if (byCategory !== 0) return byCategory;
    const byId = a.id.localeCompare(b.id);
    return byId !== 0 ? byId : a.rule.localeCompare(b.rule);
  });
  return items;
}
