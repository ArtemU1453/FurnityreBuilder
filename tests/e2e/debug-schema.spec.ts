import { expect, test } from '@playwright/test';

/**
 * Технический debug-renderer существует только в режиме разработки
 * (docs/GEOMETRY_RULES.md §12) — этот файл запускается отдельным
 * Playwright-проектом против `npm run dev`, а не против собранного
 * production-превью (см. playwright.config.ts).
 *
 * Проверяет ровно то, что unit-тесты `buildDebugView` проверить не могут:
 * реальную отрисовку SVG в браузере и полный интерактивный путь
 * «нажатие → команда → пересчёт → перерисовка схемы».
 */

test('схема появляется в режиме разработки и отражает реальную геометрию', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema).toBeVisible();

  // 4 детали каркаса + задняя стенка (деталь с PROMPT 14) + 1 нераздёленная
  // ячейка = 6 прямоугольников. Счёт задней стенки добавлен во все проверки
  // этого файла разом: она строится по умолчанию в любом изделии.
  // CSS-модули хешируют имена классов — различать «деталь»/«ячейку» по
  // классу в E2E ненадёжно, поэтому здесь проверяется общее число
  // прямоугольников, а не их разбивка по виду (та проверена в
  // tests/unit/render/debug-view.test.ts на уровне данных).
  await expect(schema.locator('rect')).toHaveCount(6);
});

test('применение сетки перестраивает схему: перегородки и ячейки появляются вживую', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(6);

  await page.getByLabel('Строк').fill('2');
  await page.getByLabel('Колонок').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  // 2×3: 4 детали каркаса + 4 вертикальные перегородки (2 на ряд × 2 ряда)
  // + 1 горизонтальный разделитель = 9 деталей, плюс 6 ячеек = 15.
  await expect(schema.locator('rect')).toHaveCount(16);
});

test('переключатель debug-инфо показывает и скрывает подписи ID и координат', async ({ page }) => {
  await page.goto('/');

  const toggle = page.getByLabel('Показывать ID и координаты');
  await expect(toggle).not.toBeChecked();

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  const debugTextBefore = await schema.locator('text').filter({ hasText: 'side ·' }).count();
  expect(debugTextBefore).toBe(0);

  await toggle.check();
  await expect(schema.locator('text').filter({ hasText: 'side ·' }).first()).toBeVisible();

  await toggle.uncheck();
  await expect(schema.locator('text').filter({ hasText: 'side ·' })).toHaveCount(0);
});

test('полки появляются в схеме как отдельные детали и подписываются в debug-инфо', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(6);

  await page.getByLabel('Полок в ячейке').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  // 4 детали каркаса + 3 полки + 1 ячейка = 8 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(9);
  // Счётчик «Полок» в панели результата — точное совпадение текста, иначе
  // локатор поймал бы и подпись поля «Полок в ячейке».
  await expect(page.getByText('Полок', { exact: true }).locator('..')).toContainText('3');

  // Подпись полки в debug-инфо несёт ширину, глубину, толщину и Y
  // (PROMPT 6 §27) — и берёт их из GeometryResult, а не считает заново.
  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('text').filter({ hasText: 'shelf-adjustable ·' }).first()).toBeVisible();
});

test('изменение числа секций перестраивает перегородки и подписывает секции', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.getByText('SECTION 1')).toBeVisible();
  await expect(schema.getByText('SECTION 2')).toHaveCount(0);

  await page.getByLabel('Секций', { exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();

  // Счётчики читаем в панели результата: те же слова есть и в подписях полей.
  const stats = page.getByRole('complementary', { name: 'Результат расчёта' });

  // 3 секции → 2 перегородки, и по подписи на каждую секцию.
  await expect(schema.getByText('SECTION 3')).toBeVisible();
  await expect(stats.getByText('Перегородок').locator('..')).toContainText('2');
  await expect(stats.getByText('Секций').locator('..')).toContainText('3');

  // Обратное изменение убирает лишние перегородки и подписи.
  await page.getByLabel('Секций', { exact: true }).fill('1');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect(schema.getByText('SECTION 2')).toHaveCount(0);
  await expect(stats.getByText('Перегородок').locator('..')).toContainText('0');
});

test('индивидуальные ширины секций применяются и видны в схеме', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  const stats = page.getByRole('complementary', { name: 'Результат расчёта' });

  // Габарит подбираем так, чтобы 300 + 500 + 400 сошлось с боковинами
  // и двумя перегородками: 1200 + 32 + 32 = 1264.
  await page.getByLabel('Ширина, мм').fill('1264');
  await page.getByLabel('Секций', { exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await expect(stats.getByText('Секций').locator('..')).toContainText('3');

  await page.getByLabel('Ширины секций, мм').fill('300, 500, 400');
  await page.getByRole('button', { name: 'Применить ширины' }).click();

  // Схема подписывает каждую секцию её собственной шириной.
  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.getByText('Ш 300', { exact: false }).first()).toBeVisible();
  await expect(schema.getByText('Ш 500', { exact: false }).first()).toBeVisible();
  await expect(schema.getByText('Ш 400', { exact: false }).first()).toBeVisible();

  // Несходящаяся сумма не строит геометрию молча, а объясняется текстом.
  await page.getByLabel('Ширины секций, мм').fill('200, 200, 200');
  await page.getByRole('button', { name: 'Применить ширины' }).click();
  // Локатор сужен до панели проблем: с PROMPT 19 тот же текст ошибки
  // встречается ещё и в техническом выводе спецификации, и без сужения
  // локатор находит два элемента.
  await expect(page.getByLabel('Результат расчёта').getByText(/не заполняют доступное пространство/)).toBeVisible();

  // Одна отмена возвращает предыдущий набор ширин целиком.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(schema.getByText('Ш 500', { exact: false }).first()).toBeVisible();
});

test('наполнение ячейки подписано в схеме и меняется вместе с моделью', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  // Новая ячейка пуста — и это видно, а не подразумевается.
  await expect(schema.getByText('CONTENT: ПУСТО')).toBeVisible();

  await page.getByLabel('Полок в ячейке').fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();

  await expect(schema.getByText('CONTENT: ПОЛКИ')).toBeVisible();
  await expect(schema.getByText('CONTENT: ПУСТО')).toHaveCount(0);
});

test('дверь появляется в схеме и подписана содержимым ячейки (PROMPT 10 §18)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.getByText('CONTENT: ПУСТО')).toBeVisible();

  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await page.getByLabel('Двери').getByRole('button', { name: 'Добавить дверь' }).click();

  // 4 детали каркаса + 1 дверь = 5 деталей, плюс 1 ячейка = 6 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(7);
  await expect(schema.getByText(/CONTENT: ПУСТО · ДВЕРЬ/)).toBeVisible();

  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('text').filter({ hasText: 'петли слева' }).first()).toBeVisible();

  await page.getByLabel('Сторона петель').selectOption('right');
  await expect(schema.locator('text').filter({ hasText: 'петли справа' }).first()).toBeVisible();

  await page.getByLabel('Двери').getByRole('button', { name: 'Убрать дверь' }).click();
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.getByText(/CONTENT: ПУСТО · ДВЕРЬ/)).toHaveCount(0);
});

test('фасады ящиков появляются в схеме и подписаны CONTENT: ЯЩИКИ (PROMPT 11 §20)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.getByText('CONTENT: ПУСТО')).toBeVisible();

  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  const addDrawerButton = page.getByLabel('Ящики').getByRole('button', { name: 'Добавить ящик', exact: true });
  await addDrawerButton.click();
  await addDrawerButton.click();

  // 4 детали каркаса + 2 фасада ящиков = 6 деталей, плюс 1 ячейка = 7 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(8);
  await expect(schema.getByText('CONTENT: ЯЩИКИ')).toBeVisible();
  // Фасад ящика — не дверь: пометки ДВЕРЬ на ячейке с ящиками быть не должно.
  await expect(schema.getByText(/ДВЕРЬ/)).toHaveCount(0);

  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('text').filter({ hasText: 'Фасад ящика' }).first()).toBeVisible();

  await page.getByLabel('Ящики').getByRole('button', { name: 'Убрать ящик', exact: true }).click();
  await page.getByLabel('Ящики').getByRole('button', { name: 'Убрать ящик', exact: true }).click();
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.getByText('CONTENT: ЯЩИКИ')).toHaveCount(0);
});

test('ручка появляется в схеме и подписана в CONTENT ячейки (PROMPT 12 §18)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await expect(schema.locator('rect')).toHaveCount(6);

  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  await page.getByLabel('Двери').getByRole('button', { name: 'Добавить дверь' }).click();
  // 4 детали каркаса + 1 дверь = 5, плюс 1 ячейка = 6 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(7);

  await page.getByLabel('Открывание').selectOption('handle');
  // + 1 деталь ручки = 6 деталей, плюс 1 ячейка = 7 прямоугольников.
  await expect(schema.locator('rect')).toHaveCount(8);
  await expect(schema.getByText(/Opening: HANDLE/)).toBeVisible();

  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('text').filter({ hasText: 'ручка' }).first()).toBeVisible();

  await page.getByLabel('Открывание').selectOption('none');
  await expect(schema.locator('rect')).toHaveCount(7);
  await expect(schema.getByText(/Opening: HANDLE/)).toHaveCount(0);
});

test('изменение габарита в поле обновляет схему сразу, без перезагрузки', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  const widthDimBefore = await schema.getByText('1000 мм').count();
  expect(widthDimBefore).toBeGreaterThan(0);

  await page.getByLabel('Ширина, мм').fill('1400');

  await expect(schema.getByText('1400 мм').first()).toBeVisible();
});

test('материал и толщина детали подписаны в схеме, смена толщины материала видна сразу (PROMPT 13 §22–23)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Полок в ячейке').fill('1');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  await page.getByLabel('Показывать ID и координаты').check();

  // Подпись детали несёт имя материала, толщину и кромку (§22).
  const shelfLabel = schema.locator('text').filter({ hasText: 'shelf-adjustable ·' }).first();
  await expect(shelfLabel).toBeVisible();
  await expect(shelfLabel).toContainText('Материал: Корпусная плита 16 мм');
  await expect(shelfLabel).toContainText('Т 16 мм');
  await expect(shelfLabel).toContainText('Кромка 2/0/0.4/0.4');

  // Смена ТОЛЩИНЫ МАТЕРИАЛА (а не толщины корпуса) пересчитывает толщину
  // полки: до PROMPT 13 материал на геометрию не влиял вообще (§17).
  await page.getByLabel('Корпусная плита 16 мм, мм').fill('18');
  await expect(schema.locator('text').filter({ hasText: 'shelf-adjustable ·' }).first()).toContainText('Т 18 мм');
});

test('назначение материала роли меняет материал уже построенных деталей (PROMPT 13 §23)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Полок в ячейке').fill('1');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  await page.getByLabel('Показывать ID и координаты').check();

  const shelfLabel = () => schema.locator('text').filter({ hasText: 'shelf-adjustable ·' }).first();
  await expect(shelfLabel()).toContainText('Корпусная плита 16 мм');

  // Полке назначается материал задней стенки (3 мм) — единственный второй
  // материал стартового реестра: и имя, и толщина детали меняются вместе.
  await page.getByLabel('Материал полок').selectOption({ label: 'Задняя стенка 3 мм' });
  await expect(shelfLabel()).toContainText('Задняя стенка 3 мм');
  await expect(shelfLabel()).toContainText('Т 3 мм');

  // Один шаг истории на назначение: отмена возвращает и материал, и толщину.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(shelfLabel()).toContainText('Корпусная плита 16 мм');
  await expect(shelfLabel()).toContainText('Т 16 мм');
});

test('задняя стенка и цоколь появляются в схеме и пересчитывают корпус (PROMPT 14 §21, §27)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Показывать ID и координаты').check();

  // Задняя стенка — деталь с самого начала: 4 детали каркаса + стенка + ячейка.
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.locator('text').filter({ hasText: 'BACK WALL' }).first()).toBeVisible();

  // Отключение стенки убирает её деталь.
  await page.getByLabel('Задняя стенка', { exact: true }).selectOption('none');
  await expect(schema.locator('rect')).toHaveCount(5);
  await expect(schema.locator('text').filter({ hasText: 'BACK WALL' })).toHaveCount(0);

  await page.getByLabel('Задняя стенка', { exact: true }).selectOption('overlay');
  await expect(schema.locator('rect')).toHaveCount(6);

  // Цоколь: высота поднимает корпус и добавляет переднюю царгу.
  await page.getByLabel('Высота цоколя, мм').fill('100');
  await expect(schema.locator('text').filter({ hasText: 'PLINTH' }).first()).toBeVisible();
  await expect(schema.locator('rect')).toHaveCount(7);

  // Боковые царги добавляются явно — состав цоколя не угадывается.
  await page.getByLabel('Царги цоколя').selectOption('sides');
  await expect(schema.locator('rect')).toHaveCount(9);

  // Отмена возвращает состав, ещё одна — убирает цоколь целиком.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(schema.locator('rect')).toHaveCount(7);
});

test('разделение задней стенки по секциям даёт сегмент на секцию (PROMPT 14 §6–§7)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Секций', { exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  await page.getByLabel('Показывать ID и координаты').check();

  // 4 детали каркаса + 2 перегородки + 1 цельная стенка + 3 ячейки = 10.
  await expect(schema.locator('rect')).toHaveCount(10);

  await page.getByLabel('Разделение стенки').selectOption('per-section');
  // Цельная стенка заменилась тремя сегментами: +2 прямоугольника.
  await expect(schema.locator('rect')).toHaveCount(12);
  await expect(schema.locator('text').filter({ hasText: 'BACK WALL' }).first()).toContainText('Секция:');
});

test('модификаторы корпуса пересчитывают геометрию и видны в схеме (PROMPT 15 §16, §21)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Показывать ID и координаты').check();

  // Конструктивная сводка показывает полосы вертикального бюджета.
  await expect(schema.locator('text').filter({ hasText: 'BBOX' }).first()).toContainText('Установка floor-standing');

  // Антресоль: вторая оболочка, +4 детали (2 боковины, крышка, дно).
  await expect(schema.locator('rect')).toHaveCount(6);
  await page.getByLabel('Высота антресоли, мм').fill('400');
  await expect(schema.locator('rect')).toHaveCount(10);
  await expect(schema.locator('text').filter({ hasText: '(антресоль)' }).first()).toBeVisible();

  // Столешница: ещё одна деталь и другая полоса бюджета.
  await page.getByLabel('Толщина столешницы, мм').fill('38');
  await expect(schema.locator('rect')).toHaveCount(11);
  await expect(schema.locator('text').filter({ hasText: 'COUNTERTOP' }).first()).toBeVisible();

  // Зазор до потолка деталей не даёт, но виден в сводке.
  await page.getByLabel('Зазор до потолка, мм').fill('100');
  await expect(schema.locator('rect')).toHaveCount(11);
  await expect(schema.locator('text').filter({ hasText: 'BBOX' }).first()).toContainText('До потолка 100');

  // Отмена возвращает предыдущий шаг: зазор снят, деталей столько же.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(schema.locator('text').filter({ hasText: 'BBOX' }).first()).toContainText('До потолка 0');
});

test('фальшпанель и режим установки проходят через команды (PROMPT 15 §13, §21)', async ({ page }) => {
  await page.goto('/');

  const schema = page.getByRole('img', { name: 'Техническая схема изделия' });
  await page.getByLabel('Показывать ID и координаты').check();
  await expect(schema.locator('rect')).toHaveCount(6);

  await page.getByRole('button', { name: 'Фальшпанель справа' }).click();
  await expect(schema.locator('rect')).toHaveCount(7);
  await expect(schema.locator('text').filter({ hasText: 'FALSE PANEL' }).first()).toBeVisible();

  await page.getByLabel('Установка').selectOption('wall-mounted');
  await expect(schema.locator('text').filter({ hasText: 'BBOX' }).first()).toContainText('Установка wall-mounted');

  await page.getByRole('button', { name: 'Убрать фальшпанель' }).click();
  await expect(schema.locator('rect')).toHaveCount(6);
  await expect(schema.locator('text').filter({ hasText: 'FALSE PANEL' })).toHaveCount(0);
});

test('спецификация фурнитуры пересчитывается вместе с моделью (PROMPT 16 §20, §26)', async ({ page }) => {
  await page.goto('/');

  const hardware = page.getByRole('heading', { name: 'Фурнитура (расчёт)' });
  await expect(hardware).toBeVisible();
  const list = page.locator('h3:has-text("Фурнитура (расчёт)") + ul');

  // Технический вывод показывает все поля, которые требует §26.
  await expect(list.getByText('ID · DEFINITION · CATEGORY · QUANTITY · UNIT · SOURCE · RULE · REASON')).toBeVisible();

  // Пустой корпус: направляющих нет, зато есть внятное объяснение,
  // почему крепёж не посчитан, — вместо выдуманного числа.
  await expect(list.getByText(/hw-slide/)).toHaveCount(0);
  await expect(list.getByText(/Крепёж корпуса не рассчитан/)).toBeVisible();

  // Два ящика — четыре направляющие, без всякой команды «пересчитать».
  await page.getByLabel('Ячейка').selectOption({ index: 1 });
  const addDrawerButton = page.getByLabel('Ящики').getByRole('button', { name: 'Добавить ящик', exact: true });
  await addDrawerButton.click();
  await addDrawerButton.click();
  await expect(list.getByText(/ИТОГО · hw-slide · slide · 4 · pcs/)).toBeVisible();

  // Третий ящик — шесть: изменение модели меняет спецификацию мгновенно.
  await addDrawerButton.click();
  await expect(list.getByText(/ИТОГО · hw-slide · slide · 6 · pcs/)).toBeVisible();

  // Убрали ящики — позиция исчезла вместе со своим источником.
  await page.getByLabel('Ящики').getByRole('button', { name: 'Убрать ящик', exact: true }).click();
  await page.getByLabel('Ящики').getByRole('button', { name: 'Убрать ящик', exact: true }).click();
  await page.getByLabel('Ящики').getByRole('button', { name: 'Убрать ящик', exact: true }).click();
  await expect(list.getByText(/hw-slide/)).toHaveCount(0);
});

test('карта раскроя строится из деталей и пересчитывается вместе с ними (PROMPT 17 §30)', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Карта раскроя (debug)' })).toBeVisible();

  // Пустой корпус: два материала — корпусная плита 16 мм и задняя стенка
  // 3 мм. Объединиться в один лист они не могут: у них разная толщина.
  await expect(page.getByRole('img', { name: /^ЛИСТ / })).toHaveCount(2);
  await expect(page.getByRole('img', { name: /Корпусная плита 16 мм/ })).toHaveCount(1);
  await expect(page.getByRole('img', { name: /Задняя стенка 3 мм/ })).toHaveCount(1);

  // Полок в раскрое пока нет.
  const shelvesOnSheets = page.locator('svg[aria-label^="ЛИСТ "] text').filter({ hasText: /^Полка$/ });
  await expect(shelvesOnSheets).toHaveCount(0);

  // Добавление полок добавляет детали в раскрой само — без команды
  // «пересчитать»: карта производна от геометрии.
  await page.getByLabel('Полок в ячейке').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  // Три полки одинакового размера — одна позиция количеством 3, то есть
  // три отдельных размещения (§22), а не одно на троих.
  await expect(shelvesOnSheets).toHaveCount(3);
});





test('карта присадки объясняет, чего не хватает, вместо выдуманных отверстий (PROMPT 18 §28)', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Присадка (расчёт)' })).toBeVisible();
  const list = page.locator('h3:has-text("Присадка (расчёт)") + ul');

  // Ни один технологический параметр не подтверждён, поэтому операций нет
  // и это сказано прямо, а не показано пустым местом.
  await expect(list.getByText('— ни одной операции не рассчитано —')).toBeVisible();
  await expect(list.getByText(/Присадка крепежа задней стенки не рассчитана/)).toBeVisible();
  await expect(list.getByText(/Присадка корпусного крепежа не рассчитана/)).toBeVisible();

  // Полки добавляют не отверстия, а точное указание недостающей связи.
  await page.getByLabel('Полок в ячейке').fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  await expect(list.getByText(/какая боковина или перегородка держит полку/)).toBeVisible();
  await expect(list.getByText('— ни одной операции не рассчитано —')).toBeVisible();
});

test('спецификация собирается из всех расчётов и не прячет ограничений (PROMPT 19 §25)', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Спецификация (расчёт)' })).toBeVisible();
  const list = page.locator('h3:has-text("Спецификация (расчёт)") + ul');

  // Все четыре раздела на месте, статус честный: подтверждены не все правила.
  await expect(list.getByText(/^СТАТУС: NEEDS_CONFIRMATION/)).toBeVisible();
  await expect(list.getByText(/^ДЕТАЛИ · ID · NAME/)).toBeVisible();
  await expect(list.getByText(/^ФУРНИТУРА · DEFINITION/)).toBeVisible();
  await expect(list.getByText(/^ПРИСАДКА · операций:/)).toBeVisible();
  await expect(list.getByText(/^РАСКРОЙ · листов:/)).toBeVisible();
  await expect(list.getByText(/^ТРЕБУЕТ ПОДТВЕРЖДЕНИЯ · \d+/)).toBeVisible();

  // Две одинаковые боковины — одна строка количеством 2, а не две строки.
  await expect(list.getByText(/Боковина · side · Корпусная плита 16 мм · 16 · 2000 · 497 · 2 ·/)).toBeVisible();

  // Полки появляются в деталировке сами, одной строкой на три штуки.
  await page.getByLabel('Полок в ячейке').fill('3');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  await expect(list.getByText(/Полка · shelf · Корпусная плита 16 мм · 16 · \d+ · \d+ · 3 ·/)).toBeVisible();
});

test('debug-режим сцены показывает состав и счётчики отрисовки (PROMPT 23 §27, §31)', async ({ page }) => {
  await page.goto('/');

  const canvas = page.getByRole('img', { name: /Трёхмерный вид изделия/ });
  await expect(canvas).toBeVisible();

  const debug = page.locator('li', { hasText: 'Загрузок геометрии' });
  await expect(debug).toBeVisible();

  // Геометрия загружается в видеопамять РОВНО один раз за жизнь рендерера:
  // единичный куб. Любое другое число означало бы, что где-то появилось
  // создание геометрии на React-рендер (§31).
  await expect(debug).toContainText('1');

  await expect(page.locator('li', { hasText: 'Объектов сцены' })).toBeVisible();
  await expect(page.locator('li', { hasText: 'Вызовов отрисовки' })).toBeVisible();

  // Счётчик не должен расти от вращения: сцена та же, объекты те же.
  const before = await page.locator('li', { hasText: 'Вызовов отрисовки' }).textContent();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  await expect(page.locator('li', { hasText: 'Вызовов отрисовки' })).toHaveText(before ?? '');
  await expect(page.locator('li', { hasText: 'Загрузок геометрии' })).toContainText('1');

  // Изменение модели меняет состав сцены — и это видно в тех же счётчиках.
  await page.getByLabel('Ширина, мм').fill('1600');
  await expect(page.locator('li', { hasText: 'Объектов сцены' })).toBeVisible();
  await expect(page.locator('li', { hasText: 'Загрузок геометрии' })).toContainText('1');
});
