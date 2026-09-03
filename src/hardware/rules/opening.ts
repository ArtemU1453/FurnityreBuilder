import { issue } from '../../domain/index.js';
import type { HardwareItem, HardwareRule, HardwareRuleContext, HardwareRuleResult } from '../types.js';
import { buildHardwareItemId } from '../types.js';
import { HW_HANDLE, HW_HANDLE_FASTENER, HW_PUSH_LATCH } from '../registry.js';

/**
 * Ручки и push-to-open (PROMPT 16 §12–13).
 *
 * ## Откуда берётся количество и почему двойного учёта нет
 *
 * Источник — уже построенные ДЕТАЛИ ролей `handle` и `push-to-open`
 * (PROMPT 12): движок строит ровно одну такую деталь на один
 * `OpeningSystem`, потому что у `{kind:'handle'}` и
 * `{kind:'push-to-open'}` по одному `id`. Считать по деталям, а не по
 * конфигурации, здесь строго лучше: детали уже прошли проверки движка
 * (недопустимая геометрия ручки в результат не попадает), и получается
 * ровно один источник количества вместо двух.
 *
 * Именно это и есть защита от двойного учёта, о которой предупреждает §12:
 * push-to-open существует и как деталь, и как конфигурация, но позиция
 * спецификации порождается только одним из двух путей.
 *
 * Количество: одна ручка на деталь ручки, один механизм на деталь
 * механизма. Это не порог и не таблица — это мощность множества уже
 * построенных деталей, поэтому правило имеет статус `implemented`, а не
 * `needs-confirmation`.
 */
export const handleRule: HardwareRule = {
  id: 'handle',
  title: 'Ручки фасадов',
  status: 'implemented',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const items: HardwareItem[] = [];
    for (const part of ctx.geometry.parts) {
      if (part.role !== 'handle') continue;
      items.push({
        id: buildHardwareItemId('handle', part.id, HW_HANDLE),
        definitionId: HW_HANDLE,
        kind: 'handle',
        unit: 'pcs',
        quantity: 1,
        sourcePartId: part.id,
        ...(part.origin.nodeId === undefined ? {} : { sourceNodeId: part.origin.nodeId }),
        ruleId: 'handle',
        reason: 'одна ручка на фасад со способом открывания «ручка»',
      });
    }
    return { items, warnings: [], errors: [] };
  },
};

/**
 * Крепёж ручки — ОТДЕЛЬНАЯ позиция от самой ручки (§12: «Если крепёж ручки
 * является отдельной позицией и это подтверждено правилами»).
 *
 * Сколько винтов на ручку — зависит от типа: у штанги их два, у кнопки
 * один, у профильной и врезной — своё крепление. Референс этого не
 * подтвердил (`T-DOOR-04`), а «обычно два» — та самая выдуманная
 * величина, которую §6 и §29 запрещают. Правило существует, знает свой
 * вход и сообщает, чего ему не хватает.
 */
export const handleFastenerRule: HardwareRule = {
  id: 'handle-fastener',
  title: 'Крепёж ручек',
  status: 'needs-confirmation',
  unknownId: 'T-HW-08',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const handles = ctx.geometry.parts.filter((p) => p.role === 'handle');
    if (handles.length === 0) return { items: [], warnings: [], errors: [] };
    return {
      items: [],
      warnings: [
        issue(
          'HARDWARE_RULE_NEEDS_CONFIRMATION',
          'warning',
          `Крепёж ручек не рассчитан: число точек крепления на ручку зависит от её типа и референсом не подтверждено (T-HW-08). Ручек в изделии: ${String(handles.length)}, позиция «${String(HW_HANDLE_FASTENER)}» ждёт правила.`,
        ),
      ],
      errors: [],
    };
  },
};

/**
 * Push-to-open (§13).
 *
 * Количество механизмов на фасад référence не подтвердил (`T-HW-04`,
 * `T-HW-07`), но модель уже отвечает на этот вопрос однозначно: у фасада
 * ровно один `OpeningSystem`, и если это push-to-open — механизм один.
 * Считается, как и ручка, по построенным деталям, поэтому двойного учёта
 * с деталью роли `push-to-open` не возникает.
 */
export const pushToOpenRule: HardwareRule = {
  id: 'push-to-open',
  title: 'Механизмы push-to-open',
  status: 'implemented',
  run(ctx: HardwareRuleContext): HardwareRuleResult {
    const items: HardwareItem[] = [];
    for (const part of ctx.geometry.parts) {
      if (part.role !== 'push-to-open') continue;
      items.push({
        id: buildHardwareItemId('push-to-open', part.id, HW_PUSH_LATCH),
        definitionId: HW_PUSH_LATCH,
        kind: 'push-latch',
        unit: 'pcs',
        quantity: 1,
        sourcePartId: part.id,
        ...(part.origin.nodeId === undefined ? {} : { sourceNodeId: part.origin.nodeId }),
        ruleId: 'push-to-open',
        reason: 'один механизм на фасад со способом открывания «push-to-open»',
      });
    }
    return { items, warnings: [], errors: [] };
  },
};
