import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Дефекты финального аудита в настоящем браузере (PROMPT 31 §5, §8).
 *
 * Оба сторожат ситуации, которых не бывает в модульном тесте: они
 * возникают при СМЕНЕ открытого документа — восстановление после
 * перезагрузки вкладки и открытие проекта из библиотеки. Проверять их без
 * настоящего IndexedDB и настоящей перезагрузки нечем.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });
const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });

async function saveCurrent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('поля шага показывают структуру ОТКРЫТОГО проекта, а не единицы пустого (§5)', async ({
  page,
}) => {
  // Три секции — и сохранение, чтобы приложение восстановило их при
  // следующем открытии вкладки.
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect(scene(page)).toHaveAttribute('aria-label', /Деталей: 7/);
  await saveCurrent(page);

  await page.reload();

  // Изделие вернулось.
  await expect(scene(page)).toHaveAttribute('aria-label', /Деталей: 7/);

  // И поле показывает три, а не единицу. Пока оно показывало единицу,
  // кнопка «Применить секций: 1» схлопывала восстановленный шкаф — по
  // значению, которое пользователь видел своими глазами.
  await step(page, 'Секции').click();
  await expect(page.getByRole('spinbutton', { name: 'Секций', exact: true })).toHaveValue('3');
  await expect(page.getByRole('button', { name: /Применить секций/ })).toHaveText(
    /Применить секций: 3/,
  );
});

test('восстановленный проект не объявляется несохранённым (§8)', async ({ page }) => {
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1200');
  await saveCurrent(page);

  await page.reload();
  await expect(scene(page)).toHaveAttribute('aria-label', /1200/);

  // На диске лежит ровно то, что на экране. Заявлять «есть несохранённые
  // изменения» здесь — значит приучить не верить этому сообщению.
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();
});

test('первая же правка снова помечает проект несохранённым (§8)', async ({ page }) => {
  await saveCurrent(page);
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1234');
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeVisible();
});

test('ширины секций тоже приезжают вместе с проектом (§5)', async ({ page }) => {
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await page.getByLabel('Ширины секций, мм').fill('500, 700, 500');
  await page.getByRole('button', { name: 'Применить ширины' }).click();
  await saveCurrent(page);

  await page.reload();
  await step(page, 'Секции').click();
  await expect(page.getByLabel('Ширины секций, мм')).toHaveValue('500, 700, 500');
});

test('кнопка сетки называет и полки, которые поставит (§3)', async ({ page }) => {
  await step(page, 'Ячейки').click();
  // Без полок обещание короткое — лишнего в названии нет.
  await expect(page.getByRole('button', { name: /Применить сетку/ })).toHaveText(
    'Применить сетку 1×1',
  );

  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }).fill('3');
  // С полками кнопка говорит и о них: раньше она обещала «сетку 2×1» и
  // молча ставила ещё и полки.
  await expect(page.getByRole('button', { name: /Применить сетку/ })).toHaveText(
    'Применить сетку 2×1, полок: 3',
  );
});

test('поля полок на соседних шагах различимы по названию (§3, §4)', async ({ page }) => {
  // На шаге «Ячейки» — только «в каждой»: это черновик для всей сетки.
  await step(page, 'Ячейки').click();
  await expect(
    page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: 'Полок в выбранной ячейке', exact: true }),
  ).toHaveCount(0);

  // На шаге «Полки» — только «в выбранной», и без выбранной ячейки его нет
  // вовсе: шаг честно говорит, что полки принадлежат ячейке.
  await step(page, 'Полки').click();
  await expect(
    page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('Ячейка не выбрана')).toBeVisible();

  // Подсказка у чернового поля объясняет, почему набранное значение само
  // по себе ничего не меняет.
  await step(page, 'Ячейки').click();
  await expect(page.getByText(/Применяется вместе с сеткой/)).toBeVisible();
});
