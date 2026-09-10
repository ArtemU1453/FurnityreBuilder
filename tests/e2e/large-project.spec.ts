import { expect, test } from '@playwright/test';
import { openScene, scene } from './open-scene.js';
import type { Page } from '@playwright/test';
import { applyGrid } from './apply-grid.js';

/**
 * Крупный проект целиком (PROMPT 47, gap G-03).
 *
 * ## Какой пробел это закрывает
 *
 * Приёмка PROMPT 46 проверила крупный проект вручную и нашла его
 * рабочим. Автоматического сценария не было: набор проверял связки на
 * минимальных изделиях, где многие ошибки не проявляются — расхождение
 * сводки с деталировкой на пяти деталях незаметно, на сорока видно
 * сразу.
 *
 * ## Размеры взяты из домена, а не «побольше»
 *
 * 2400 × 2400 × 600 — обычный шкаф-купе во всю стену, сетка 3 × 4 с
 * полками — обычное наполнение. Искусственно предельные величины
 * проверяли бы поведение за границами поддерживаемого, а не продукт.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

async function partCount(page: Page): Promise<number> {
  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  const match = /Деталей: (\d+)/.exec(label);
  expect(match, `в подписи сцены нет числа деталей: ${label}`).not.toBeNull();
  return Number(match?.[1]);
}

test('крупный проект: расчёт, документы и возврат после перезагрузки', async ({ page }) => {
  test.slow();
  await page.goto('./');
  await openScene(page);
  await expect(scene(page)).toBeVisible();

  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2400');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('600');
  await expect(scene(page)).toHaveAttribute('aria-label', /2400/);

  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('4');
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
  await applyGrid(page);

  // Изделие действительно крупное, а не «стало чуть больше».
  await expect
    .poll(async () => partCount(page), { timeout: 20_000, message: 'деталей в крупном проекте' })
    .toBeGreaterThan(30);
  const parts = await partCount(page);

  const label = (await scene(page).getAttribute('aria-label')) ?? '';
  expect(label, 'подпись сцены испорчена').not.toMatch(/NaN|Infinity|undefined/);

  // ── Производство считает то же изделие ────────────────────────────
  await page.getByRole('radio', { name: 'Производство' }).click();
  await page.getByRole('radio', { name: 'Детали', exact: true }).click();
  const table = page.getByRole('table').first();
  await expect(table).toBeVisible();
  await expect(table, 'в деталировке крупного проекта NaN').not.toContainText('NaN');

  await page.getByRole('radio', { name: 'Сводка', exact: true }).click();
  const summary = page.getByRole('main');
  await expect(summary).toContainText('Деталей всего');
  const text = await summary.innerText();
  const total = Number(/Деталей всего[^\d]*(\d+)/.exec(text)?.[1] ?? -1);
  expect(total, 'сводка и сцена говорят о разном изделии').toBe(parts);

  // ── Раскрой — самый тяжёлый расчёт, и он обязан ответить ──────────
  await page.getByRole('radio', { name: 'Раскрой', exact: true }).click();
  await expect(page.getByRole('main')).not.toContainText('NaN');

  // ── Проект возвращается тем же ────────────────────────────────────
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  const before = (await scene(page).getAttribute('aria-label')) ?? '';
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible({ timeout: 30_000 });

  await page.reload();

  await openScene(page);
  await expect(scene(page)).toBeVisible({ timeout: 30_000 });
  await expect(scene(page), 'крупный проект вернулся другим').toHaveAttribute(
    'aria-label',
    before,
    { timeout: 30_000 },
  );
});
