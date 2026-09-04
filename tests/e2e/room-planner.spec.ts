import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Планировщик помещения в настоящем браузере (PROMPT 24 §33).
 *
 * Здесь проверяется только то, чего нельзя проверить без браузера:
 * настоящий указатель, захват, конфликт «вращение камеры против
 * перетаскивания мебели», сохранение через перезагрузку. Привязка,
 * пересечения и трансформации проверены модульно и без DOM
 * (`tests/unit/room/`).
 */

const canvas = (page: Page) => page.getByRole('img', { name: /Помещение/ });
const inspector = (page: Page) => page.getByLabel('Свойства помещения');

async function openPlanner(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Помещение', exact: true }).click();
  await expect(canvas(page)).toBeVisible();
}

async function addFurniture(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Добавить «/ }).first().click();
  await expect(canvas(page)).toHaveAttribute('aria-label', /Мебели: 1/);
}

/** Найти мебель на сцене щелчком: точные экранные координаты зависят от камеры. */
async function selectFurniture(page: Page): Promise<{ x: number; y: number }> {
  const box = (await canvas(page).boundingBox())!;
  for (let fy = 0.25; fy <= 0.75; fy += 0.05) {
    for (let fx = 0.25; fx <= 0.8; fx += 0.05) {
      const x = box.x + box.width * fx;
      const y = box.y + box.height * fy;
      await page.mouse.click(x, y);
      if ((await inspector(page).textContent())?.includes('Выбранный объект') === true) return { x, y };
    }
  }
  throw new Error('Мебель на сцене не найдена');
}

test('помещение создаётся и показывается в сцене (§25)', async ({ page }) => {
  await openPlanner(page);
  await expect(canvas(page)).toHaveAttribute('aria-label', /4000 × 3000 мм, высота 2700 мм/);
  await expect(inspector(page)).toContainText('Помещение');
});

test('мебель добавляется в свободное место, а не внутрь стен (§12)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  // Ноль ошибок: изделие поставлено в угол, а не в начало координат.
  await expect(canvas(page)).toHaveAttribute('aria-label', /Ошибок размещения: 0/);
});

test('щелчок по мебели выбирает её (§19)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  await selectFurniture(page);
  await expect(inspector(page)).toContainText('Выбранный объект');
  await expect(inspector(page)).toContainText('Положение X');
});

test('перетаскивание мебели меняет положение одной командой (§13, §29)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  const at = await selectFurniture(page);

  const positionX = inspector(page).getByLabel('Положение X, мм');
  const before = await positionX.inputValue();

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 90, at.y + 40, { steps: 8 });
  // Во время жеста показан числовой отсчёт положения. Локатор сужен до
  // области статуса: те же координаты есть и в инспекторе.
  await expect(page.locator('[role="status"]').filter({ hasText: /X .* · Z .* мм/ })).toBeVisible();
  await page.mouse.up();

  expect(await positionX.inputValue()).not.toBe(before);

  // Один жест — один шаг истории.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(positionX).toHaveValue(before);
});

test('вращение камеры не двигает мебель (§14)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  await selectFurniture(page);
  const positionX = inspector(page).getByLabel('Положение X, мм');
  const before = await positionX.inputValue();

  // Пустое место сцены: жест там — вращение камеры, а не перемещение.
  const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height - 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + box.height - 60, { steps: 8 });
  await page.mouse.up();

  await expect(positionX).toHaveValue(before);
});

test('поворот, блокировка, видимость и дублирование работают (§12)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  await selectFurniture(page);

  await page.getByRole('button', { name: 'Повернуть на 90°' }).click();
  await page.getByRole('button', { name: 'Заблокировать' }).click();
  await expect(page.getByRole('button', { name: 'Разблокировать' })).toBeVisible();
  // Заблокированный объект нельзя повернуть.
  await expect(page.getByRole('button', { name: 'Повернуть на 90°' })).toBeDisabled();

  await page.getByRole('button', { name: 'Разблокировать' }).click();
  await page.getByRole('button', { name: 'Скрыть' }).click();
  await expect(page.getByRole('button', { name: 'Показать' })).toBeVisible();
  await page.getByRole('button', { name: 'Показать' }).click();

  await page.getByRole('button', { name: 'Дублировать' }).click();
  await expect(canvas(page)).toHaveAttribute('aria-label', /Мебели: 2/);
});

test('мебель убирается из помещения, изделие остаётся в проекте', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  await selectFurniture(page);
  await page.getByRole('button', { name: 'Убрать из помещения' }).click();
  await expect(canvas(page)).toHaveAttribute('aria-label', /Мебели: 0/);

  // Изделие никуда не делось: в редакторе оно на месте.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByRole('img', { name: /Трёхмерный вид изделия/ })).toBeVisible();
});

test('габарит помещения правится с клавиатуры (§24)', async ({ page }) => {
  await openPlanner(page);
  // Локатор сужен до инспектора помещения: поле «Ширина, мм» есть и у
  // изделия в боковой панели, и без сужения правится не то.
  const width = inspector(page).getByLabel('Ширина, мм');
  await width.fill('5200');
  await expect(canvas(page)).toHaveAttribute('aria-label', /5200 × 3000/);
});

test('стандартные виды помещения переключают камеру (§23)', async ({ page }) => {
  await openPlanner(page);
  const before = await canvas(page).screenshot();
  await page.getByRole('button', { name: 'План', exact: true }).click();
  await page.waitForTimeout(150);
  expect(Buffer.compare(before, await canvas(page).screenshot())).not.toBe(0);
});

test('прозрачные стены переключаются и меняют картинку (§22)', async ({ page }) => {
  await openPlanner(page);
  const before = await canvas(page).screenshot();
  await page.getByRole('button', { name: 'Прозрачные стены' }).click();
  await page.waitForTimeout(150);
  expect(Buffer.compare(before, await canvas(page).screenshot())).not.toBe(0);
});

test('помещение и расстановка переживают перезагрузку (§28)', async ({ page }) => {
  await openPlanner(page);
  await addFurniture(page);
  await inspector(page).getByLabel('Ширина, мм').fill('4600');

  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByLabel('Состояние проекта')).toContainText('Сохранено');

  await page.reload();
  await page.getByRole('button', { name: 'Помещение', exact: true }).click();
  await expect(canvas(page)).toHaveAttribute('aria-label', /4600 × 3000/);
  await expect(canvas(page)).toHaveAttribute('aria-label', /Мебели: 1/);
});

test('сцена помещения захватывает указатель на время жеста (§14)', async ({ page }) => {
  await openPlanner(page);
  const captured = await page.evaluate(() => {
    const host = document.querySelector('canvas')?.parentElement;
    if (!(host instanceof HTMLElement)) return null;
    const rect = host.getBoundingClientRect();
    const options = {
      pointerId: 11,
      pointerType: 'mouse',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      bubbles: true,
      isPrimary: true,
    };
    let seen = false;
    const original = host.setPointerCapture.bind(host);
    host.setPointerCapture = (id: number): void => {
      seen = true;
      try {
        original(id);
      } catch {
        /* синтетический указатель браузер не захватывает */
      }
    };
    host.dispatchEvent(new PointerEvent('pointerdown', options));
    host.dispatchEvent(new PointerEvent('pointerup', options));
    return seen;
  });
  expect(captured).toBe(true);
});
