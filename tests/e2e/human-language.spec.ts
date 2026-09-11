import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * FR-12: интерфейс говорит о мебели, а не о своём устройстве
 * (PROMPT 58 §14, §20).
 *
 * ## Дефект, который здесь сторожится
 *
 * Аудит PROMPT 53 нашёл в конструкторе `Bounding box (Ш×В×Г)`,
 * «Этапы конвейера геометрии, ещё не реализованные: edges, drilling» и
 * `Деталь · back` — имена полей и этапов движка в русском интерфейсе.
 *
 * ## Почему проверка адресная, а не снимок экрана (§15)
 *
 * Снимок всех слов заморозил бы каждую формулировку и ломался бы от
 * любой правки текста. Здесь проверяются НАЗВАННЫЕ утечки и общее
 * правило: в обычном сценарии не должно появляться латиницы, кроме
 * заранее перечисленных обозначений.
 */

/** Латиница, которая в русском интерфейсе законна. */
const ALLOWED = [
  'Ctrl', // подписи горячих клавиш
  'Shift',
  'PDF', // форматы выгрузки
  'XLSX',
  'Push-to-open', // отраслевое название механизма открывания
  'push-to-open',
];

/**
 * Латинские слова в видимом тексте, кроме разрешённых.
 *
 * Считается ТОЛЬКО то, что действительно на экране: текстовые узлы
 * внутри элементов ненулевого размера.
 */
async function latinLeaks(page: Page, allowed: readonly string[] = ALLOWED): Promise<string[]> {
  return page.evaluate((ok) => {
    const found = new Map<string, string>();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walk.nextNode()) !== null) {
      const el = node.parentElement;
      if (el === null) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const text = node.textContent ?? '';
      for (const match of text.matchAll(/[A-Za-z][A-Za-z-]{2,}/g)) {
        const word = match[0];
        if (ok.some((allowedWord) => allowedWord.toLowerCase().includes(word.toLowerCase()))) continue;
        if (!found.has(word)) found.set(word, text.trim().slice(0, 80));
      }
    }
    return [...found.entries()].map(([word, context]) => `${word} :: ${context}`);
  }, allowed);
}

const schema = (page: Page) => page.getByRole('application', { name: /Схема изделия/ });

test('наблюдённые утечки исчезли из постоянно видимой панели (§10, §20 B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  const main = page.locator('main');
  await expect(main).not.toContainText('Bounding box');
  await expect(main).not.toContainText('edges');
  await expect(main).not.toContainText('drilling');
  await expect(main).not.toContainText('Этапы конвейера геометрии');

  // Сведения не убраны, а переписаны в последствиях (§9).
  await expect(main).toContainText('Внешний габарит');
  await expect(main).toContainText('В геометрии пока не строятся: кромка и присадка');
});

test('роль детали названа по-мебельному, а не полем модели (§6, §20 B)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // Задняя стенка выбирается в сцене: на схеме её перекрывает отделение.
  await page.getByRole('radio', { name: 'Сцена', exact: true }).check();
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await expect(page.getByRole('heading', { name: 'Задняя стенка' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Деталь · задняя стенка');
  await expect(page.locator('main')).not.toContainText('Деталь · back');
});

test('обычный сценарий на широком экране не показывает латиницы (§12, §20 D)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  // 1. Открытие.
  expect(await latinLeaks(page), 'латиница при первом открытии').toEqual([]);

  // 2. Габариты.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).blur();
  expect(await latinLeaks(page), 'латиница после ввода габарита').toEqual([]);

  /*
    3. Отделение выбрано, действия предложены.

    Выбор делается ОДИН раз: после наполнения полки рисуются поверх
    отделения и перехватывают щелчок по нему. Дверь ставится тем же
    выделением, а не повторным попаданием в занятую ячейку.
  */
  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  await page.getByRole('button', { name: 'Добавить дверь' }).click();
  expect(await latinLeaks(page), 'латиница после установки двери').toEqual([]);

  // 4. Наполнение — через шаг «Полки», у которого своё поле.
  await page
    .getByRole('navigation', { name: 'Этапы конструктора' })
    .getByRole('button', { name: 'Полки' })
    .click();
  await page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Полок в выбранном отделении', exact: true }).blur();
  expect(await latinLeaks(page), 'латиница после наполнения отделения').toEqual([]);
});

test('обычный сценарий на телефоне не показывает латиницы (§14)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');

  expect(await latinLeaks(page), 'латиница при первом открытии на телефоне').toEqual([]);

  await page.getByRole('button', { name: 'Размеры', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1700');
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).blur();
  expect(await latinLeaks(page), 'латиница в листе параметров').toEqual([]);

  await page.getByRole('dialog', { name: 'Размеры' }).getByRole('button', { name: 'Закрыть' }).click();
  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  expect(await latinLeaks(page), 'латиница после выбора отделения на телефоне').toEqual([]);
});

test('раздел фурнитуры не показывает значений перечислений (§3, §12)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  await page.getByRole('button', { name: 'Добавить дверь' }).click();

  await page.getByRole('radio', { name: 'Производство' }).check();
  await page.getByRole('radio', { name: 'Фурнитура', exact: true }).check();

  const main = page.locator('main');
  await expect(main).toContainText('Фурнитура');

  /*
    Способ монтажа задней стенки словом, а не значением модели: здесь
    было «монтаж: «overlay»» — латинское значение перечисления в русском
    предупреждении. Найдено сплошным обходом видимого текста уже после
    четырёх наблюдённых подписей.
  */
  await expect(main).toContainText('монтаж: «накладная»');
  await expect(main, 'значение перечисления показано как есть').not.toContainText('«overlay»');

  // Виды фурнитуры, когда позиции рассчитаны, называются словами.
  await expect(main).not.toContainText('shelf-support');
  await expect(main).not.toContainText('confirmat');
});

/**
 * Прослеживаемость неподтверждённых правил — НЕ утечка (§9, §20 C).
 *
 * Раздел готовности показывает «Правило в коде: src/…» и идентификатор
 * вида `T-DRW-02`. Это подписанное намеренно свидетельство того, что
 * норма не подтверждена источником, а не случайно попавшее имя поля.
 * Проверка закрепляет, что оно на месте: убрать его было бы потерей
 * производственной информации.
 */
test('прослеживаемость неподтверждённого правила осталась (§9)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await page.getByRole('radio', { name: 'Производство' }).check();

  const main = page.locator('main');
  await expect(main).toContainText('Правило в коде');
  await expect(main).toContainText(/T-[A-Z]+-\d+/);
});

/**
 * Позиция, которую правило не смогло посчитать, названа мебельным
 * словом, а не ключом реестра (PROMPT 62 §8, §10).
 *
 * ## Здесь пересмотрено решение PROMPT 58
 *
 * Этот тест закреплял обратное: `Позиция «hw-hinge»` считалась
 * прослеживаемостью, а не утечкой, и проверка существовала затем, чтобы
 * следующий обход её не стёр.
 *
 * PROMPT 61 измерил, к чему это привело: производственный раздел
 * говорил `hw-hinge`, `hw-back-fastener`, `hw-shelf-support` человеку,
 * который пришёл за раскроем. Ключ реестра не отвечает ни на «что
 * это», ни на «что делать»: искать по нему некуда — ни артикула, ни
 * поставщика в приложении нет и не будет, о чём прямо сказано в
 * подписи панели.
 *
 * Прослеживаемость при этом не потеряна и проверяется тестом выше:
 * рядом остаются код неподтверждённого правила (`T-DOOR-05`) и ссылка
 * на само правило. Изменился адресат подписи, а не наличие источника
 * (§16: сначала смысл, потом откуда).
 */
test('непосчитанная позиция названа словом, а не ключом реестра (§8, §10)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await schema(page).getByRole('button', { name: /^Всё внутреннее/ }).click();
  await page.getByRole('button', { name: 'Добавить дверь' }).click();
  await page.getByRole('radio', { name: 'Производство' }).check();
  await page.getByRole('radio', { name: 'Фурнитура', exact: true }).check();

  const main = page.locator('main');
  await expect(main).toContainText('Позиция «петля»');
  await expect(main).not.toContainText('hw-hinge');
  // Источник на месте: причина названа, правило указано.
  await expect(main).toContainText('T-DOOR-05');
});
