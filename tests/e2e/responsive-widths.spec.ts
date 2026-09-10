import { expect, test } from '@playwright/test';
import { openScene } from './open-scene.js';
import type { Page } from '@playwright/test';

/**
 * Раскладка на четырёх ширинах (PROMPT 48 §14).
 *
 * ## Что здесь проверяется и что нет
 *
 * Проверяется одно объективное свойство: страница не едет вбок ни на
 * одном разделе. Горизонтальная полоса прокрутки — это не вопрос вкуса:
 * она означает, что часть интерфейса недостижима, и её видно числом.
 *
 * Снимков экрана здесь нет намеренно. Расхождение в один пиксель красит
 * прогон чаще, чем находит дефект, а «стало некрасиво» проверкой не
 * выражается (`docs/CI_QUALITY_GATES.md`, «Чего в CI нет намеренно»).
 *
 * `mobile.spec.ts` покрывает телефон подробно — жесты, листы, цели для
 * пальца. Здесь другое: одна и та же проверка на ВСЕХ четырёх ширинах,
 * включая планшет и десктоп, которых там нет.
 */

const SCREENS = ['Конструктор', 'Производство', 'Помещение', 'Библиотека'] as const;

const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const WIDTHS = [
  { width: 360, height: 740, name: 'малый телефон', touch: true },
  { width: 430, height: 930, name: 'крупный телефон', touch: true },
  { width: 834, height: 1112, name: 'планшет', touch: false },
  { width: 1440, height: 900, name: 'десктоп', touch: false },
] as const;

for (const { width, height, name, touch } of WIDTHS) {
  test.describe(`${name}, ${String(width)} px`, () => {
    test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });

    test('ни один раздел не уводит страницу вбок', async ({ page }) => {
      await page.goto('./');
      await openScene(page);
      await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toBeVisible();

      for (const screen of SCREENS) {
        await page.getByRole('radio', { name: screen, exact: true }).click();
        await expect(page.getByRole('radio', { name: screen, exact: true })).toBeChecked();
        expect(await overflowOf(page), `${screen} на ${String(width)} px едет вбок`).toBeLessThanOrEqual(0);
      }
    });

    test('главное действие доступно и правка доходит до модели', async ({ page }) => {
      await page.goto('./');
      await openScene(page);
      await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toBeVisible();

      // На телефоне параметры приходят листом — открываем его тем же
      // способом, каким это делает человек.
      const sheet = page.getByRole('button', { name: 'Размеры', exact: true });
      if ((await sheet.count()) > 0 && (await sheet.first().isVisible())) {
        await sheet.first().click();
      }

      const field = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
      await expect(field).toBeVisible();
      await field.fill('1550');
      await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toHaveAttribute(
        'aria-label',
        /1550/,
      );

      // Сохранение достижимо на любой ширине: это конец пути, и он не
      // должен упираться в раскладку.
      await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
    });
  });
}
