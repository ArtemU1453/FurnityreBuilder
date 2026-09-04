import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Адаптивность (PROMPT 26 §27–§28).
 *
 * Проверяется не «выглядит красиво», а два свойства, которые ломаются
 * молча: страница не должна прокручиваться вбок ни на одной ширине, и на
 * телефоне навигация должна оказаться внизу, а не остаться уменьшенной
 * копией десктопной панели.
 */

const SIZES = [
  { name: 'десктоп', width: 1440, height: 900 },
  { name: 'планшет', width: 1024, height: 768 },
  { name: 'телефон', width: 390, height: 844 },
] as const;

/** Горизонтальная прокрутка страницы — всегда дефект раскладки. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

for (const size of SIZES) {
  test(`${size.name}: страница не едет вбок ни в одном разделе`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');

    for (const section of ['Конструктор', 'Библиотека', 'Помещение', 'Производство']) {
      await page.getByRole('radio', { name: section }).click();
      // Небольшой допуск: субпиксельная ширина рамок округляется вверх.
      expect(await horizontalOverflow(page), `${size.name} · ${section}`).toBeLessThanOrEqual(1);
    }
  });
}

test('телефон: навигация внизу, под большим пальцем', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const nav = page.getByRole('radiogroup', { name: 'Раздел' });
  const top = page.getByRole('heading', { level: 1 });

  const navBox = (await nav.boundingBox())!;
  const topBox = (await top.boundingBox())!;

  // Навигация ниже имени проекта — то есть уехала из шапки вниз, а не
  // осталась уменьшенной десктопной панелью.
  expect(navBox.y).toBeGreaterThan(topBox.y);
  // И она в нижней половине экрана.
  expect(navBox.y).toBeGreaterThan(844 / 2);
});

test('десктоп: навигация вверху, инспектор рядом с холстом', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const nav = (await page.getByRole('radiogroup', { name: 'Раздел' }).boundingBox())!;
  expect(nav.y).toBeLessThan(200);

  // Три колонки: параметры, холст, инспектор — инспектор правее холста.
  const canvas = (await page.getByRole('img', { name: /Трёхмерный вид/ }).boundingBox())!;
  const inspector = (await page.getByLabel('Свойства объекта').boundingBox())!;
  expect(inspector.x).toBeGreaterThan(canvas.x);
});

test('зоны попадания не меньше 44 px (§28)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  /*
    Проверяется ЗОНА ПОПАДАНИЯ, а не высота рисунка. Кнопка остаётся
    32 px — увеличивать её значило бы менять облик ради теста, — а до
    44 px её добирает прозрачный псевдоэлемент. Поэтому измеряется не
    `getBoundingClientRect().height`, а попадание указателя выше и ниже
    видимой границы: именно это чувствует палец.
  */
  const missed = await page.evaluate(() => {
    const out: string[] = [];
    const nodes = [...document.querySelectorAll('input[type="radio"], button')];
    for (const node of nodes) {
      // `elementFromPoint` работает только в пределах окна, поэтому
      // элемент сначала подводится к центру экрана. Без этого всё, что
      // ниже сгиба, давало ложное «не попал».
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height >= 44) continue;

      const cx = rect.left + rect.width / 2;
      const reach = (44 - rect.height) / 2 - 1;
      const above = document.elementFromPoint(cx, rect.top - reach);
      const below = document.elementFromPoint(cx, rect.bottom + reach);
      const hits = (found: Element | null): boolean =>
        found !== null && (found === node || node.contains(found) || found.contains(node));

      if (!hits(above) || !hits(below)) {
        out.push(node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '?');
      }
    }
    return out.slice(0, 10);
  });
  expect(missed).toEqual([]);
});
