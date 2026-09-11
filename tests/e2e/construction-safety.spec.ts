import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * FR-02: обычное продолжение работы не уничтожает конструкцию
 * (PROMPT 55 §12, §16).
 *
 * ## Дефект, который здесь сторожится
 *
 * Измерено на собранном приложении (PROMPT 53):
 *
 * ```
 * 7 деталей / 3 секции / 2 перегородки
 *        ↓  действие по умолчанию шага «Ячейки»
 * 5 деталей / 1 секция / 0 перегородок
 * ```
 *
 * Проверяется ПОЛЬЗОВАТЕЛЬСКИЙ путь целиком: человек строит секции,
 * переходит на следующий шаг лестницы и нажимает главную кнопку панели.
 * Внутреннее состояние не читается — только то, что видно на экране.
 */

const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });

/**
 * Число из блока «Результат расчёта» — того же, что видит человек.
 *
 * Чтение скоплено этой панелью НАМЕРЕННО: инспектор справа показывает
 * часть тех же подписей («Секций», «Деталей») для выбранного объекта, и
 * без области поиска тест читал бы то одно, то другое. Проверяется
 * видимый текст, а не состояние приложения.
 */
async function metric(page: Page, label: string): Promise<number> {
  const value = await page.evaluate((name) => {
    const panel = [...document.querySelectorAll('section, div')].find(
      (el) => el.querySelector('h2')?.textContent?.trim() === 'Результат расчёта',
    );
    const scope = panel ?? document;
    const row = [...scope.querySelectorAll('li')].find(
      (li) => li.firstElementChild?.textContent?.trim() === name,
    );
    return row?.lastElementChild?.textContent?.trim() ?? '';
  }, label);
  return Number(value.replace(/\s/g, ''));
}

const shape = async (page: Page) => ({
  parts: await metric(page, 'Деталей'),
  sections: await metric(page, 'Секций'),
  partitions: await metric(page, 'Перегородок'),
  cells: await metric(page, 'Ячеек'),
});

/** Построить три секции — исходное состояние дефекта. */
async function threeSections(page: Page): Promise<void> {
  await page.goto('./');
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect.poll(async () => (await shape(page)).sections).toBe(3);
}

test('три секции и два разделителя переживают действие по умолчанию следующего шага (§16 A–D)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  const before = await shape(page);
  expect(before).toMatchObject({ parts: 7, sections: 3, partitions: 2 });

  // Человек идёт дальше по лестнице — ровно как предлагает интерфейс.
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByRole('heading', { name: 'Ячейки', exact: true })).toBeVisible();

  // И нажимает главную кнопку панели, ничего не настраивая.
  const primary = page.getByRole('button', { name: /^Разделить/ });
  await expect(primary).toBeVisible();

  // При 1×1 и без полок делить нечего — кнопка честно ничего не делает.
  if (await primary.isEnabled()) await primary.click();
  await page.waitForTimeout(300);

  const after = await shape(page);
  expect(after.sections, 'три секции обязаны остаться').toBe(3);
  expect(after.partitions, 'два разделителя обязаны остаться').toBe(2);
  expect(after.parts, 'ни одна деталь не должна пропасть').toBe(before.parts);

  // Ни отмены, ни подтверждения для этого не потребовалось (§16 E).
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('деление добавляет ряды в выбранное отделение и не трогает соседние (§16 C, D)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);
  const before = await shape(page);

  await step(page, 'Ячейки').click();
  await page
    .getByRole('application', { name: /Схема изделия/ })
    .getByRole('button', { name: /^Секция 2/ })
    .click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('3');

  await page.getByRole('button', { name: /^Разделить «Секция 2»/ }).click();
  await expect.poll(async () => (await shape(page)).cells).toBe(5);

  const after = await shape(page);
  expect(after.sections, 'секции не тронуты').toBe(3);
  expect(after.partitions, 'разделители секций не тронуты').toBe(2);
  expect(after.parts, 'ряды добавляют детали, а не убавляют').toBeGreaterThan(before.parts);
});

test('пересборка всего изделия — отдельное явное действие с подтверждением (§16 F)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  await step(page, 'Ячейки').click();

  // Разрушительного действия НЕТ среди обычных кнопок панели: чтобы до
  // него добраться, надо раскрыть отдельный раздел.
  const destructive = page.getByRole('button', { name: /Пересобрать всё изделие/ });
  await expect(destructive).toBeHidden();

  await page.getByText('Начать внутреннее устройство заново').click();
  await expect(destructive).toBeVisible();
  await destructive.click();

  // И оно спрашивает, называя потерю поимённо.
  const confirm = page.getByRole('dialog', { name: 'Сетка заменит внутреннее устройство' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('3 секции');

  await confirm.getByRole('button', { name: 'Заменить' }).click();
  await expect.poll(async () => (await shape(page)).sections).toBe(1);

  // Отмена возвращает конструкцию целиком (§13).
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await shape(page)).sections).toBe(3);
  const restored = await shape(page);
  expect(restored).toMatchObject({ parts: 7, sections: 3, partitions: 2 });
});

test('отмена деления — один шаг, а не столько, сколько было команд (§13)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await threeSections(page);

  await step(page, 'Ячейки').click();
  await page
    .getByRole('application', { name: /Схема изделия/ })
    .getByRole('button', { name: /^Секция 1/ })
    .click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('2');
  await page.getByRole('button', { name: /^Разделить «Секция 1»/ }).click();
  await expect.poll(async () => (await shape(page)).cells).toBe(6);

  // Одно деление — одно нажатие Ctrl+Z, хотя команд под ним несколько.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await shape(page)).cells).toBe(3);
  expect(await shape(page)).toMatchObject({ parts: 7, sections: 3, partitions: 2 });
});

test('деление занятого отделения спрашивает, пустого — нет (§7)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await step(page, 'Ячейки').click();

  const schema = page.getByRole('application', { name: /Схема изделия/ });
  const rows = page.getByRole('spinbutton', { name: 'Строк', exact: true });
  const shelves = page.getByRole('spinbutton', { name: 'Полок в каждой ячейке', exact: true });
  const divide = page.getByRole('button', { name: /^Разделить/ });

  // 1. Пустое отделение делится молча.
  await rows.fill('2');
  await divide.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await shape(page)).cells).toBe(2);

  // 2. Поставить полки в верхний ряд — тоже без вопроса: это не потеря.
  await schema.getByRole('button', { name: /^Ряд 1/ }).click();
  await rows.fill('1');
  await shelves.fill('2');
  await divide.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await shape(page)).cells).toBe(2);
  const occupied = await shape(page);

  // 3. Разделить тот же ряд, в котором теперь стоят полки, — вопрос.
  await rows.fill('2');
  await shelves.fill('0');
  await divide.click();

  const ask = page.getByRole('dialog', { name: 'Отделение уже занято' });
  await expect(ask).toBeVisible();
  await expect(ask).toContainText('Остальное изделие');

  // 4. Отказ не меняет ничего.
  await ask.getByRole('button', { name: 'Отмена' }).click();
  await expect(ask).toBeHidden();
  expect(await shape(page)).toEqual(occupied);
});

/** §14: главное и разрушительное действия различимы на каждом размере окна. */
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 390, height: 844 },
]) {
  const name = `${String(viewport.width)} × ${String(viewport.height)}`;
  const mobile = viewport.width < 900;

  test(`конструкция переживает действие по умолчанию на ${name} (§14, §16 G)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('./');

    /*
      На телефоне лестница свёрнута до текущего шага, а панель шага
      живёт выдвижным листом (`MobileSteps`, `WorkspaceSlot`). Путь тот
      же, что у человека с телефоном, и тот же, которым ходит
      `mobile.spec.ts`.
    */
    const goStep = async (title: string): Promise<void> => {
      if (!mobile) {
        await step(page, title).click();
        return;
      }
      await page
        .getByRole('navigation', { name: 'Этапы конструктора' })
        .getByRole('button', { name: /Шаг \d+ из 11/ })
        .click();
      await page.getByRole('dialog', { name: 'Этапы' }).getByRole('button', { name: title }).click();
      await page.getByRole('button', { name: title, exact: true }).click();
    };
    const closeSheet = async (title: string): Promise<void> => {
      if (!mobile) return;
      await page.getByRole('dialog', { name: title }).getByRole('button', { name: 'Закрыть' }).click();
    };

    // Три секции.
    await goStep('Секции');
    await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
    await page.getByRole('button', { name: /Применить секций/ }).click();
    await expect.poll(async () => (await shape(page)).sections).toBe(3);
    await closeSheet('Секции');

    // Следующий шаг — и его главное действие.
    await goStep('Ячейки');
    const primary = page.getByRole('button', { name: /^Разделить/ });
    await expect(primary).toBeVisible();

    // Разрушительное действие не стоит среди обычных кнопок ни на одном
    // размере окна: до него надо раскрыть отдельный раздел.
    await expect(page.getByRole('button', { name: /Пересобрать всё изделие/ })).toBeHidden();

    if (await primary.isEnabled()) await primary.click();
    await page.waitForTimeout(300);

    const after = await shape(page);
    expect(after.sections, 'три секции обязаны остаться').toBe(3);
    expect(after.partitions, 'два разделителя обязаны остаться').toBe(2);
    expect(after.parts).toBe(7);
  });
}
