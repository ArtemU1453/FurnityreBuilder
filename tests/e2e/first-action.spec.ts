import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * FR-05: первое действие видно без прокрутки (PROMPT 56 §13, §19).
 *
 * ## Дефект, который здесь сторожится
 *
 * Измерено аудитом PROMPT 53 и подтверждено перед правкой: в окнах
 * 1440 × 900 и 1280 × 800 поле «Ширина» начиналось на 888-м пикселе —
 * ниже края экрана. Лестница из одиннадцати шагов занимала 672 px и
 * открывала боковую колонку, так что из 22 видимых органов управления
 * 20 были навигацией и НИ ОДНОГО — редактируемым полем.
 *
 * Проверяется фактическая видимость по координатам, а не наличие в DOM:
 * элемент, лежащий на 888-м пикселе восьмисотпиксельного окна, в DOM
 * есть и при этом невидим.
 */

/** Действительно ли элемент попадает в окно целиком. */
async function visibleInViewport(locator: Locator, height: number): Promise<boolean> {
  const box = await locator.boundingBox();
  if (box === null) return false;
  return box.y >= 0 && box.y + box.height <= height && box.width > 0;
}

const field = (page: Page, label: string) =>
  page.getByRole('spinbutton', { name: label, exact: true });

/** Прокрутки не было: проверяется и страница, и боковая колонка. */
async function nothingScrolled(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    if (document.documentElement.scrollTop > 0 || document.body.scrollTop > 0) return false;
    return [...document.querySelectorAll('*')].every((el) => el.scrollTop === 0);
  });
}

const DESKTOP = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

for (const viewport of DESKTOP) {
  const name = `${String(viewport.width)} × ${String(viewport.height)}`;

  test(`первое действие видно без прокрутки на ${name} (§19 A–C)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');

    // Ни одного прокручивания не сделано — измеряем ровно то, что видит
    // человек сразу после открытия.
    expect(await nothingScrolled(page), 'тест сам что-то прокрутил').toBe(true);

    // Все четыре первичных параметра видны целиком.
    for (const label of ['Ширина', 'Высота', 'Глубина', 'Толщина']) {
      const input = field(page, label);
      await expect(input).toBeVisible();
      expect(
        await visibleInViewport(input, viewport.height),
        `поле «${label}» не помещается в окно`,
      ).toBe(true);
    }

    // Изделие видно вместе с ними: действие и его предмет на одном экране.
    const canvas = page.getByRole('application', { name: /Схема изделия/ });
    expect(await visibleInViewport(canvas, viewport.height)).toBe(true);

    // И видно, что именно строим.
    await expect(page.getByRole('heading', { name: 'Новый проект', level: 1 })).toBeVisible();
  });

  test(`навигация не занимает больше внимания, чем действие, на ${name} (§12)', `, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');

    const ladder = page.getByRole('navigation', { name: 'Этапы конструктора' });
    const width = field(page, 'Ширина');

    const ladderBox = (await ladder.boundingBox())!;
    const widthBox = (await width.boundingBox())!;

    // Действие ВЫШЕ навигации — запрещённый порядок §12 не воспроизводится.
    expect(widthBox.y, 'поле габарита оказалось ниже лестницы шагов').toBeLessThan(ladderBox.y);

    // Лестница при этом никуда не делась и остаётся находимой.
    await expect(ladder.getByRole('button', { name: /Производство/ })).toBeAttached();
    await expect(ladder).toContainText('Шаг 1 из 11');
  });

  test(`поле можно сразу править, и изделие отвечает, на ${name} (§14)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');

    const width = field(page, 'Ширина');

    // Фокус — без предварительной прокрутки и без закрытия чего-либо.
    await width.focus();
    await expect(width).toBeFocused();

    await width.fill('1750');
    await width.blur();

    // Изделие пересчиталось: холст знает новую ширину.
    await expect(page.getByRole('application', { name: /Схема изделия/ })).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const panel = [...document.querySelectorAll('section, div')].find(
            (el) => el.querySelector('h2')?.textContent?.trim() === 'Результат расчёта',
          );
          const row = [...(panel ?? document).querySelectorAll('li')].find(
            (li) => li.firstElementChild?.textContent?.trim() === 'Внутренняя ширина',
          );
          return row?.lastElementChild?.textContent?.trim() ?? '';
        }),
      )
      .toContain('1718');
  });
}

/**
 * Телефон (§19 D): раскладка, которую аудит PROMPT 53 назвал удачнее
 * настольной, не должна ухудшиться.
 *
 * Параметры там живут выдвижным листом НАМЕРЕННО — именно поэтому холст
 * занимает экран. Требование «видно без прокрутки» выполняется другим
 * способом: первое действие названо на экране кнопкой, и одно касание
 * открывает поля. Проверяется и то, и другое.
 */
test('на 390 × 844 первое действие названо на экране и открывается одним касанием (§19 D)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  /*
    Холст остаётся САМОЙ КРУПНОЙ областью экрана — то, ради чего лист и
    существует.

    До PROMPT 57 здесь стояло `> 400 px`. Круглое число было моим, а не
    измеренным: оно выражало «изделие занимает экран». PROMPT 57 добавил
    над изделием строку «что строим», и она честно отнимает у холста
    свою высоту. Требование при этом не изменилось, поэтому проверяется
    оно само — превосходство над каждой другой областью, — а не число,
    подобранное под прежнюю раскладку. Такая проверка строже: она
    сломается и в том случае, когда холст останется 420 px, а шапка
    вырастет до 430.
  */
  const canvasBox = (await page.getByRole('application', { name: /Схема изделия/ }).boundingBox())!;
  const others = await page.evaluate(() =>
    ['header', 'footer', 'nav', '[class*="mobileBar"]']
      .map((sel) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0)
      .map((h) => Math.round(h)),
  );
  for (const height of others) {
    expect(canvasBox.height, `холст перестал быть самой крупной областью: ${String(height)} px`).toBeGreaterThan(
      height,
    );
  }
  // И занимает существенную долю экрана, а не полоску.
  expect(canvasBox.height / 844).toBeGreaterThan(0.35);

  // Первое действие названо: кнопка носит имя текущего шага.
  const open = page.getByRole('button', { name: 'Размеры', exact: true });
  expect(await visibleInViewport(open, 844), 'кнопка «Размеры» не видна').toBe(true);

  // Одно касание — и поля на экране.
  await open.click();
  for (const label of ['Ширина', 'Высота', 'Глубина', 'Толщина']) {
    const input = field(page, label);
    await expect(input).toBeVisible();
    expect(await visibleInViewport(input, 844), `поле «${label}» не помещается`).toBe(true);
  }

  // И правка доходит до изделия.
  await field(page, 'Ширина').fill('1750');
  await field(page, 'Ширина').blur();
  await expect(page.getByRole('dialog', { name: 'Размеры' })).toBeVisible();
});
