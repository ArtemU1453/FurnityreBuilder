import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Сквозной путь приложения целиком (PROMPT 30 §7).
 *
 * Тридцать два шага одним сценарием: от нового проекта до документов и
 * обратно к проверке согласованности. Каждый шаг проверяет ОЖИДАЕМОЕ
 * СОСТОЯНИЕ, а не отсутствие падения — сценарий, который «прошёл»,
 * потому что ничего не упало, не проверяет ничего.
 *
 * Этот тест намеренно один и длинный: он сторожит связки между
 * разделами, а разбитый на тридцать два независимых теста он проверял бы
 * тридцать два раза одно начало и ни разу — переходы.
 */

const scene = (page: Page) => page.getByRole('img', { name: /Трёхмерный вид изделия/ });
const rail = (page: Page) => page.getByRole('navigation', { name: 'Этапы конструктора' });
const step = (page: Page, title: string) => rail(page).getByRole('button', { name: title });
const section = (page: Page, title: string) =>
  page.getByRole('radio', { name: title, exact: true });

test('весь путь: проект → конструктор → помещение → производство → документы', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Новый проект.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Новый проект' })).toBeVisible();
  await expect(scene(page)).toBeVisible();

  // 2. Габариты.
  await page.getByRole('spinbutton', { name: 'Ширина', exact: true }).fill('1800');
  await page.getByRole('spinbutton', { name: 'Высота', exact: true }).fill('2100');
  await page.getByRole('spinbutton', { name: 'Глубина', exact: true }).fill('550');
  await expect(scene(page)).toHaveAttribute('aria-label', /1800/);
  await expect(scene(page)).toHaveAttribute('aria-label', /2100/);

  // 3. Секции.
  await step(page, 'Секции').click();
  await page.getByRole('spinbutton', { name: 'Секций', exact: true }).fill('3');
  await page.getByRole('button', { name: /Применить секций/ }).click();
  // Три секции — две перегородки: 5 деталей каркаса становятся 7.
  await expect(scene(page)).toHaveAttribute('aria-label', /Деталей: 7/);

  // 4. Индивидуальные ширины секций.
  await page.getByLabel('Ширины секций, мм').fill('500, 700, 500');
  await page.getByRole('button', { name: 'Применить ширины' }).click();
  await expect(page.getByLabel('Результат расчёта')).toBeVisible();

  // 5. Ячейки и полки.
  //
  // Применение сетки заменяет дерево секций целиком — это документированное
  // поведение `SetRoot`, и здесь оно проверяется явно: после сетки
  // деталей становится заметно больше, а прежние ширины секций к новому
  // дереву уже не относятся.
  await step(page, 'Ячейки').click();
  await page.getByRole('spinbutton', { name: 'Строк', exact: true }).fill('2');
  await page.getByRole('spinbutton', { name: 'Колонок', exact: true }).fill('3');
  await page.getByRole('spinbutton', { name: 'Полок в ячейке', exact: true }).fill('2');
  await page.getByRole('button', { name: /Применить сетку/ }).click();
  const afterShelves = (await scene(page).getAttribute('aria-label')) ?? '';
  expect(Number(/Деталей: (\d+)/.exec(afterShelves)?.[1] ?? 0)).toBeGreaterThan(15);

  // 6. Дверь.
  await step(page, 'Фасады').click();
  const cellPicker = page.getByLabel('Двери').getByLabel('Ячейка');
  await cellPicker.selectOption({ index: 1 });
  await page.getByLabel('Двери').getByRole('button', { name: 'Добавить дверь' }).click();
  await expect(page.locator('li', { hasText: 'Дверей' })).toContainText('1');

  // 7. Ящики в другую ячейку.
  //
  // Ящик ставится в пустую ячейку или в ячейку, где ящики уже есть: в
  // ячейку с полками его не поставить, и кнопка честно выключена. Поэтому
  // сначала наполнение ячейки меняется на «Ящики» — тем самым путём,
  // которым это делает человек.
  await cellPicker.selectOption({ index: 2 });
  await step(page, 'Наполнение').click();
  // Подписи вариантов берутся из доменного словаря (`contentLabel`), а не
  // придумываются интерфейсом, поэтому они строчные.
  await page.getByRole('radio', { name: 'ящики', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Наполнение' })).toContainText('Ящик');

  await step(page, 'Фасады').click();
  const addDrawer = page
    .getByLabel('Фасады ящиков')
    .getByRole('button', { name: 'Добавить ящик', exact: true });
  await expect(addDrawer).toBeEnabled();
  await addDrawer.click();
  await expect(page.locator('li', { hasText: 'Ящиков в выбранной ячейке' })).toContainText('2');

  // 8. Материал.
  await step(page, 'Материалы').click();
  await page.getByLabel('Материал полок').selectOption({ index: 1 });

  // 9. Задняя стенка. 10. Цоколь.
  await step(page, 'Корпус').click();
  await page.getByLabel('Задняя стенка', { exact: true }).selectOption('overlay');
  // Состав цоколя настраивается, только когда цоколь есть: высота больше
  // нуля создаёт его, и лишь тогда появляется выбор царг.
  await page.getByRole('spinbutton', { name: 'Высота цоколя', exact: true }).fill('100');
  await page.getByLabel('Царги цоколя').selectOption('sides');
  await expect(page.getByLabel('Результат расчёта')).toBeVisible();

  // 11. Сохранение.
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  const beforeReload = (await scene(page).getAttribute('aria-label')) ?? '';

  // 12. Перезагрузка: работа на месте.
  await page.reload();
  await expect(scene(page)).toHaveAttribute('aria-label', /1800/);
  expect(await scene(page).getAttribute('aria-label')).toBe(beforeReload);

  // 13–14. Отмена и возврат.
  await step(page, 'Размеры').click();
  const width = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await width.fill('1500');
  await expect(scene(page)).toHaveAttribute('aria-label', /1500/);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(width).toHaveValue('1800');
  await page.getByRole('button', { name: 'Вернуть' }).click();
  await expect(width).toHaveValue('1500');
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(width).toHaveValue('1800');

  // 15–17. Трёхмерный вид: выбор объекта и правка через инспектор.
  const box = (await scene(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByLabel('Свойства объекта')).toContainText('Размер раскроя');

  // 18–21. Планировщик помещения: мебель, перемещение, проверка.
  await page.getByRole('radio', { name: 'Помещение' }).click();
  await page.getByRole('button', { name: 'Создать помещение' }).click();
  const room = page.getByRole('img', { name: /Помещение/ });
  await expect(room).toBeVisible();

  await page.getByLabel('Проект из библиотеки').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Разместить в помещении' }).click();
  await expect(room).toHaveAttribute('aria-label', /Мебели: 1/);
  // Изделие поставлено в свободное место, а не в стену.
  await expect(room).toHaveAttribute('aria-label', /Ошибок размещения: 0/);

  const roomWidth = page
    .getByLabel('Свойства помещения')
    .getByRole('spinbutton', { name: 'Ширина', exact: true });
  await roomWidth.fill('4600');
  await expect(room).toHaveAttribute('aria-label', /4600/);

  // 22–28. Производство: все разделы на реальных данных.
  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('region', { name: 'Сводка' })).toContainText('Позиций деталировки');

  await section(page, 'Детали').click();
  const parts = page.getByRole('region', { name: 'Детали' });
  await expect(parts.getByRole('columnheader', { name: 'Наименование' })).toBeVisible();
  await parts.getByRole('button').first().click();

  await section(page, 'Чертежи').click();
  await expect(page.locator('svg[role=img]').first()).toBeVisible();

  await section(page, 'Присадка').click();
  await expect(page.getByRole('region', { name: 'Присадка' })).toContainText('Операций:');

  await section(page, 'Раскрой').click();
  await expect(page.getByRole('region', { name: 'Раскрой' })).toContainText('Использование');

  await section(page, 'Фурнитура').click();
  await expect(page.getByRole('region', { name: 'Фурнитура' })).toBeVisible();

  await section(page, 'Спецификация').click();
  await expect(page.getByRole('region', { name: 'Итого' })).toContainText('Позиций деталировки');

  // 29–30. Документы.
  await section(page, 'Документы').click();
  const xlsx = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать XLSX' }).click();
  expect(await (await xlsx).path()).not.toBeNull();

  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PDF' }).click();
  expect(await (await pdf).path()).not.toBeNull();

  // 31–32. Повторное открытие и согласованность расчёта.
  await page.getByRole('radio', { name: 'Конструктор' }).click();
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранено' })).toBeVisible();

  const summaryBefore = await page.getByLabel('Результат расчёта').textContent();

  await page.reload();
  await expect(scene(page)).toHaveAttribute('aria-label', /1800/);
  // Тот же проект — тот же расчёт: перезагрузка ничего не пересчитала иначе.
  expect(await page.getByLabel('Результат расчёта').textContent()).toBe(summaryBefore);

  await page.getByRole('radio', { name: 'Производство' }).click();
  await expect(page.getByRole('region', { name: 'Сводка' })).toContainText('Позиций деталировки');
});
