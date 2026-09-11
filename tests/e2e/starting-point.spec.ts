import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * FR-06: что человек строит — сказано (PROMPT 57 §11–§14, §16).
 *
 * ## Дефект, который здесь сторожится
 *
 * Аудит PROMPT 53: приложение открывалось готовым объектом из пяти
 * деталей под именем «Изделие 1» и не сообщало ни что это, ни что
 * получится, ни что делать после габаритов. Поиск по видимому тексту не
 * давал ни одного вхождения слов «с чего начать» или «тип изделия».
 *
 * Проверяется ВИДИМЫЙ текст, а не внутреннее состояние, и проверяется
 * то, что подпись следует за изделием: заученная строка прошла бы
 * первую проверку и провалила остальные.
 */

async function visibleInViewport(locator: Locator, height: number): Promise<boolean> {
  const box = await locator.boundingBox();
  if (box === null) return false;
  return box.y >= 0 && box.y + box.height <= height && box.width > 0;
}

/*
  Строка целиком, а не её половина: «что это» и «что дальше» — два
  элемента внутри одного абзаца, и проверять надо оба сразу.
  `data-stage` ставит сам компонент и несёт смысл — этап сборки.
*/
const intro = (page: Page) => page.locator('p[data-stage]').first();
const field = (page: Page, label: string) => page.getByRole('spinbutton', { name: label, exact: true });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });
const schema = (page: Page) => page.getByRole('application', { name: /Схема изделия/ });

const VIEWPORTS = [
  { width: 1280, height: 800, mobile: false },
  { width: 1440, height: 900, mobile: false },
  { width: 1920, height: 1080, mobile: false },
  { width: 390, height: 844, mobile: true },
];

for (const viewport of VIEWPORTS) {
  const name = `${String(viewport.width)} × ${String(viewport.height)}`;

  test(`при первом открытии сказано, что строится, на ${name} (§12, §16 A)`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('./');

    // Что это за объект — видно без прокрутки и без открытия чего-либо.
    await expect(intro(page)).toBeVisible();
    expect(await visibleInViewport(intro(page), viewport.height)).toBe(true);
    await expect(intro(page)).toContainText('Пустой корпус');
    await expect(intro(page)).toContainText('1000 × 2000 × 500 мм');

    /*
      И что делать дальше (§16 D).

      На широком экране это вторая половина той же строки. На телефоне
      её там нет намеренно: замер показал, что вторая фраза отнимает у
      сцены 34 px из 344 и она перестаёт быть самой крупной областью
      экрана — свойство, ради которого мобильная раскладка и сделана
      (`mobile.spec.ts`, §4). Что делать дальше, там сказано полосой
      шагов и кнопкой с именем текущего шага, и это проверяется.
    */
    if (!viewport.mobile) {
      await expect(intro(page)).toContainText('Дальше:');
      await expect(intro(page)).toContainText('разделите корпус на отделения');
    } else {
      await expect(page.getByRole('navigation', { name: 'Этапы конструктора' })).toContainText(
        'Шаг 1 из 11',
      );
      await expect(page.getByRole('button', { name: 'Размеры', exact: true })).toBeVisible();
    }

    // FR-05 не откатан: габариты остаются первыми полями (§16 C).
    if (!viewport.mobile) {
      for (const label of ['Ширина', 'Высота', 'Глубина', 'Толщина']) {
        expect(
          await visibleInViewport(field(page, label), viewport.height),
          `поле «${label}» перестало помещаться`,
        ).toBe(true);
      }
    } else {
      // На телефоне поля в листе — как и было принято в PROMPT 56.
      await page.getByRole('button', { name: 'Размеры', exact: true }).click();
      await expect(field(page, 'Ширина')).toBeVisible();
    }
  });
}

test('интерфейс не обещает видов мебели, которых модель не различает (§16 B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  /*
    `FurnitureKind` объявляет «шкаф / стеллаж / тумба / комод», но ни
    геометрия, ни производство, ни экспорт по ним не ветвятся: все
    четыре дают одинаковое изделие. Предлагать такой выбор значило бы
    пообещать различие, которого нет.
  */
  const main = page.locator('main');
  for (const word of ['Шкаф', 'Тумба', 'Комод', 'Стеллаж', 'Тип изделия', 'Тип мебели']) {
    await expect(main, `интерфейс предлагает «${word}», хотя модель этого не различает`).not.toContainText(
      word,
    );
  }
});

test('подпись следует за изделием, а не повторяет заученное (§11)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // 1. Габарит меняется — меняется и подпись.
  await field(page, 'Ширина').fill('1800');
  await field(page, 'Ширина').blur();
  await expect(intro(page)).toContainText('1800 × 2000 × 500 мм');

  // 2. Корпус разделён — подпись говорит о числе отделений и зовёт их
  //    наполнить, а не повторяет «пустой корпус».
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('3');
  await page.getByRole('button', { name: /^Разделить/ }).click();
  await expect(intro(page)).toContainText('3 отделения');
  await expect(intro(page)).toContainText('положите в него полки');
  await expect(intro(page)).not.toContainText('Пустой корпус');

  // 3. Отделение наполнено — следующим назван фасад или производство.
  await schema(page).getByRole('button', { name: /^Ряд 1/ }).click();
  await page.getByRole('button', { name: 'Добавить полки' }).click();
  await expect(intro(page)).toContainText('занято');
  await expect(intro(page)).toContainText('производству');
});

test('объяснение не блокирует работу: ни окна, ни мастера, ни кнопки «понятно» (§10, §16 E)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // Ни одного диалога при открытии.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // И работать можно сразу: первое поле принимает правку без единого
  // предварительного действия.
  await field(page, 'Ширина').fill('1750');
  await field(page, 'Ширина').blur();
  await expect(intro(page)).toContainText('1750 ×');
});

test('P0 не сломан: отделение выбирается и предлагает действия (§13)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  await field(page, 'Ширина').fill('1800');
  await field(page, 'Высота').fill('2200');
  await field(page, 'Глубина').fill('600');

  await schema(page).getByRole('button', { name: /^Всё внутреннее пространство/ }).click();
  await expect(page.getByRole('heading', { name: 'Всё внутреннее пространство' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить полки' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить ящики' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить дверь' })).toBeVisible();
});

test('FR-02 не сломан: секции переживают деление (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  await field(page, 'Ширина').fill('1800');

  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect(intro(page)).toContainText('3 отделения');

  await step(page, 'Ячейки').click();
  await schema(page).getByRole('button', { name: /^Секция 2/ }).click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('button', { name: /^Разделить «Секция 2»/ }).click();

  // Деление добавило отделения, а не заменило изделие.
  await expect(intro(page)).toContainText('4 отделения');
  await expect(page.locator('main')).toContainText('Перегородок');
  const partitions = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('section, div')].find(
      (el) => el.querySelector('h2')?.textContent?.trim() === 'Результат расчёта',
    );
    const row = [...(panel ?? document).querySelectorAll('li')].find(
      (li) => li.firstElementChild?.textContent?.trim() === 'Перегородок',
    );
    return Number(row?.lastElementChild?.textContent?.trim() ?? '0');
  });
  expect(partitions, 'перегородки секций пропали').toBe(2);
});
