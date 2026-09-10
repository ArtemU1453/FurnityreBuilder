import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Открыть трёхмерную сцену.
 *
 * ## Почему это стало отдельным действием
 *
 * До PROMPT 54 конструктор открывался сценой, и сценарии обращались к
 * её холсту сразу после `goto`. С PROMPT 54 по умолчанию открывается
 * СХЕМА: аудит PROMPT 53 измерил, что в сцене ячейка не выбирается ни
 * одним щелчком, а на схеме — каждым (`docs/P0_CELL_SELECTION_*.md`).
 *
 * Сцена никуда не делась и проверяется ровно так же, как раньше, —
 * просто теперь до неё нужно дойти тем же щелчком, что и пользователю.
 * Ни одно утверждение здесь не смягчается и ничего не пропускается.
 *
 * `check()` идемпотентен: если сцена уже открыта, помощник ничего не
 * меняет.
 */
export const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

export async function openScene(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Сцена', exact: true }).check();
  await expect(scene(page)).toBeVisible();
}
