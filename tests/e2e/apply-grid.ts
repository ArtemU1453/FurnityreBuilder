import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Нажать «Применить сетку» и подтвердить замену, если она о ней спросит.
 *
 * ## Почему помощник, а не просто клик
 *
 * Сетка выполняет `SetRoot` — замену всего дерева изделия. Аудит
 * PROMPT 46 показал, что до этого она делала это молча и стирала
 * секции, набранные шагом раньше. Теперь замена спрашивает, когда есть
 * что терять (`docs/PRODUCT_ACCEPTANCE_MATRIX.md`).
 *
 * Сценарии, которым важна сама сетка, а не диалог, проходят его этим
 * помощником. Утверждения при этом не смягчаются: помощник ничего не
 * пропускает и ничего не игнорирует — он лишь отвечает «Заменить» там,
 * где пользователь ответил бы то же самое. Сам диалог проверяется по
 * существу в `section-loss.spec.ts`.
 *
 * Пустое изделие заменяется без вопроса — тогда подтверждать нечего, и
 * помощник просто возвращается.
 */
export async function applyGrid(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  const confirm = page.getByRole('dialog', { name: 'Сетка заменит внутреннее устройство' });
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: 'Заменить' }).click();
    await expect(confirm).toBeHidden();
  }
}
