import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Телефон и планшет в настоящем браузере (PROMPT 28 §46, §48).
 *
 * Проверяется то, чего нельзя проверить без браузера и без настоящего
 * касания: что холст занимает экран, что параметры приходят листом и
 * лист не закрывает изделие, что палец действительно попадает в
 * контролы, что жест на сцене доводится до конца и отменяется, и что
 * поворот экрана не теряет ни работу, ни выделение.
 *
 * Разбор размеров на режимы проверен без DOM
 * (`tests/unit/app/layout.test.ts`) — здесь только поведение.
 */

const PHONE = { width: 390, height: 844 };
const PHONE_LANDSCAPE = { width: 844, height: 390 };
const TABLET = { width: 768, height: 1024 };

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });
const overflowOf = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('телефон', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('холст занимает экран, а параметры приходят листом (§4, §7)', async ({ page }) => {
    await page.goto('/');

    // Панели не лежат стопкой под холстом: пока лист не открыт, их нет.
    await expect(page.getByRole('region', { name: 'Размеры' })).toBeHidden();
    await expect(scene(page)).toBeVisible();

    const box = (await scene(page).boundingBox())!;
    // Изделие занимает существенную часть экрана, а не треть.
    expect(box.height).toBeGreaterThan(PHONE.height * 0.35);

    await page.getByRole('button', { name: 'Размеры', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Размеры' })).toBeVisible();

    // Лист немодальный: изделие видно и под ним (§8).
    await expect(scene(page)).toBeVisible();
  });

  test('правка в листе сразу меняет изделие (§8)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Размеры', exact: true }).click();

    const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
    await width.fill('1500');
    await expect(scene(page)).toHaveAttribute('aria-label', /1500/);
  });

  test('шаги — текущий и переходы, весь список в листе (§24)', async ({ page }) => {
    await page.goto('/');
    const bar = page.getByRole('navigation', { name: 'Этапы конструктора' });
    await expect(bar).toContainText('Шаг 1 из 11');

    // Одиннадцати вкладок сразу нет: в полосе только текущий шаг.
    await expect(bar.getByRole('button', { name: 'Материалы' })).toHaveCount(0);

    await bar.getByRole('button', { name: 'Следующий этап' }).click();
    await expect(bar).toContainText('Шаг 2 из 11');

    // Весь список — в листе, и это та же лестница, что на десктопе.
    await bar.getByRole('button', { name: /Шаг 2 из 11/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Этапы' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Материалы' }).click();
    // Выбор шага закрывает список сам.
    await expect(sheet).toBeHidden();
    await expect(bar).toContainText('Шаг 8 из 11');
  });

  test('страница не едет вбок ни на одном разделе (§35)', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Библиотека', 'Помещение', 'Производство', 'Конструктор']) {
      await page.getByRole('radio', { name }).click();
      await page.waitForTimeout(150);
      expect(await overflowOf(page), name).toBeLessThanOrEqual(0);
    }
  });

  test('цели для пальца не меньше 40 px (§11)', async ({ page }) => {
    await page.goto('/');
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll('button, a[href], input, select')) {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.height < 40) {
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim();
          out.push(`${name.slice(0, 24)} ${String(Math.round(box.height))}px`);
        }
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('касание выбирает деталь и открывает её лист (§18)', async ({ page }) => {
    await page.goto('/');
    const box = (await scene(page).boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    await page.getByRole('button', { name: 'Объект' }).click();
    await expect(page.getByRole('dialog', { name: 'Выбранный объект' })).toBeVisible();
  });

  test('жест на сцене отменяется, а не залипает (§12)', async ({ page }) => {
    await page.goto('/');
    const before = await scene(page).getAttribute('aria-label');
    const box = (await scene(page).boundingBox())!;

    // pointercancel приходит, когда жест перехватила система: сцена
    // обязана отпустить захват и не оставить изделие «в перетаскивании».
    await page.evaluate(() => {
      const host = document.querySelector('canvas')?.parentElement;
      if (!(host instanceof HTMLElement)) return;
      const rect = host.getBoundingClientRect();
      const options = {
        pointerId: 7,
        pointerType: 'touch',
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        isPrimary: true,
      };
      host.dispatchEvent(new PointerEvent('pointerdown', options));
      host.dispatchEvent(
        new PointerEvent('pointermove', { ...options, clientX: options.clientX + 40 }),
      );
      host.dispatchEvent(new PointerEvent('pointercancel', options));
    });

    // Сцена по-прежнему принимает жесты: следующий тап работает.
    await page.touchscreen.tap(box.x + 8, box.y + 8);
    expect(await scene(page).getAttribute('aria-label')).toBe(before);
  });

  test('весь путь до производства проходится пальцем (§48)', async ({ page }) => {
    await page.goto('/');

    // Размеры.
    await page.getByRole('button', { name: 'Размеры', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1600');
    await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2000');

    // Лист закрывается явной кнопкой: кнопка, которой его открыли,
    // осталась под ним (§8).
    await page
      .getByRole('dialog', { name: 'Размеры' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    // Секции.
    const bar = page.getByRole('navigation', { name: 'Этапы конструктора' });
    await bar.getByRole('button', { name: /Шаг \d+ из 11/ }).click();
    await page
      .getByRole('dialog', { name: 'Этапы' })
      .getByRole('button', { name: 'Секции' })
      .click();
    await page.getByRole('button', { name: 'Секции', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
    await page.getByRole('button', { name: /Применить секций/ }).click();
    // Три секции — две перегородки: 5 деталей каркаса становятся 7.
    await expect(scene(page)).toHaveAttribute('aria-label', /Деталей: 7/);
    await page
      .getByRole('dialog', { name: 'Секции' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    // Сохранение и производство.
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

    await page.getByRole('radio', { name: 'Производство' }).click();
    await expect(page.getByRole('region', { name: 'Готовность к производству' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Скачать XLSX' })).toBeEnabled();

    // Перезагрузка: работа на месте.
    await page.reload();
    await page.getByRole('radio', { name: 'Конструктор' }).click();
    await page.getByRole('button', { name: 'Размеры', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Ширина', exact: true })).toHaveValue('1600');
  });

  test('уточнения на производстве свёрнуты, ошибки — нет (§31, §33)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: 'Производство' }).click();
    const disclosure = page.getByText(/Требуется уточнение: \d+/).first();
    await expect(disclosure).toBeVisible();
    // Содержимое приходит по требованию, а не занимает экран заранее.
    await disclosure.click();
    await expect(page.getByText(/Применяется:/).first()).toBeVisible();
  });

  test('помещение: холст, мебель и свойства листами (§28)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

    await page.getByRole('radio', { name: 'Помещение' }).click();
    await page.getByRole('button', { name: 'Создать помещение' }).click();
    await expect(page.getByRole('img', { name: /Помещение/ })).toBeVisible();

    await page.getByRole('button', { name: 'Мебель', exact: true }).click();
    const place = page.getByRole('dialog', { name: 'Мебель в помещении' });
    await expect(place).toBeVisible();
    await place.getByLabel('Проект из библиотеки').selectOption({ index: 1 });
    await place.getByRole('button', { name: 'Разместить в помещении' }).click();
    await expect(page.getByRole('img', { name: /Помещение/ })).toHaveAttribute(
      'aria-label',
      /Мебели: 1/,
    );
  });
});

test.describe('крупный проект', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('много секций, рядов и полок остаются управляемыми (§41)', async ({ page }) => {
    await page.goto('/');

    // 4 секции × сетка 3×3 с полками — заметно больше деталей, чем в
    // изделии по умолчанию. Смысл проверки не в числе, а в том, что при
    // нём телефон остаётся рабочим: холст на месте, страница не едет
    // вбок, шаги переключаются, расчёт доходит до производства.
    await page.getByRole('button', { name: 'Размеры', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('2400');
    await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2400');
    await page
      .getByRole('dialog', { name: 'Размеры' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    const bar = page.getByRole('navigation', { name: 'Этапы конструктора' });
    const openStep = async (title: string): Promise<void> => {
      await bar.getByRole('button', { name: /Шаг \d+ из 11/ }).click();
      await page
        .getByRole('dialog', { name: 'Этапы' })
        .getByRole('button', { name: title })
        .click();
      await page.getByRole('button', { name: title, exact: true }).click();
    };

    await openStep('Секции');
    await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('4');
    await page.getByRole('button', { name: /Применить секций/ }).click();
    await page
      .getByRole('dialog', { name: 'Секции' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    await openStep('Ячейки');
    await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('3');
    await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('3');
    await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('2');
    await page.getByRole('button', { name: /Применить сетку/ }).click();
    await page
      .getByRole('dialog', { name: 'Ячейки' })
      .getByRole('button', { name: 'Закрыть' })
      .click();

    // Изделие пересчитано и показано: деталей заметно больше пяти.
    const label = (await scene(page).getAttribute('aria-label')) ?? '';
    const parts = Number(/Деталей: (\d+)/.exec(label)?.[1] ?? '0');
    expect(parts).toBeGreaterThan(30);

    // Телефон остаётся рабочим.
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expect(scene(page)).toBeVisible();

    // Расчёт доходит до производства.
    await page.getByRole('radio', { name: 'Производство' }).click();
    await expect(page.getByRole('region', { name: 'Готовность к производству' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Скачать XLSX' })).toBeEnabled();
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('поворот экрана', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('поворот не теряет ни работу, ни размеры (§42)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Размеры', exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1700');
    await expect(scene(page)).toHaveAttribute('aria-label', /1700/);

    await page.setViewportSize(PHONE_LANDSCAPE);
    await page.waitForTimeout(200);
    // Альбомная ориентация телефона — тоже телефон: полоса шагов на месте.
    await expect(page.getByRole('navigation', { name: 'Этапы конструктора' })).toContainText(
      'Шаг 1 из 11',
    );
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expect(scene(page)).toHaveAttribute('aria-label', /1700/);

    await page.setViewportSize(PHONE);
    await page.waitForTimeout(200);
    await expect(scene(page)).toHaveAttribute('aria-label', /1700/);
  });
});

test.describe('планшет', () => {
  test.use({ viewport: TABLET, hasTouch: true });

  test('колонка параметров остаётся, листов нет (§3)', async ({ page }) => {
    await page.goto('/');
    // На планшете панель шага видна сразу, без нажатия.
    await expect(page.getByRole('region', { name: 'Размеры' })).toBeVisible();
    // И это полная лестница шагов, а не полоса с одним шагом.
    await expect(
      page.getByRole('navigation', { name: 'Этапы конструктора' }).getByRole('button', {
        name: 'Материалы',
      }),
    ).toBeVisible();
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  });
});
