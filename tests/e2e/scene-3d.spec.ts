import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Трёхмерная сцена в настоящем браузере (PROMPT 23 §37).
 *
 * Здесь проверяется только то, чего нельзя проверить без браузера:
 * работает ли WebGL, ведёт ли себя указатель как указатель, меняется ли
 * картинка от вращения. Математика камеры, разбор сцены и попадание луча
 * проверены модульно и без DOM (`tests/unit/scene/`) — повторять их здесь
 * значило бы платить за то же знание в двадцать раз дороже.
 */

const canvasOf = (page: Page) =>
  page.getByRole('img', { name: /Трёхмерный вид изделия/ });

test('сцена запускается на WebGL и показывает изделие', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();

  // Контекст именно WebGL 2: на первом же кадре видно, если рендерер не
  // создался и на экране осталась пустая разметка.
  const info = await page.evaluate(() => {
    const element = document.querySelector('canvas');
    if (element === null) return null;
    return { hasGl: element.getContext('webgl2') !== null, width: element.width, height: element.height };
  });
  expect(info?.hasGl).toBe(true);
  expect(info?.width ?? 0).toBeGreaterThan(100);

  // Габариты берутся из движка и подписаны на сцене (§26).
  await expect(page.getByText('1000', { exact: true }).first()).toBeVisible();
});

test('имя сцены для скринридера описывает изделие, а не «холст» (§34)', async ({ page }) => {
  await page.goto('/');
  const label = await canvasOf(page).getAttribute('aria-label');
  expect(label).toContain('ширина 1000');
  expect(label).toContain('высота 2000');
  expect(label).toContain('Деталей');
});

test('щелчок по детали выбирает её и показывает в инспекторе (§19)', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const inspector = page.getByLabel('Свойства объекта');
  await expect(inspector.getByRole('heading')).not.toHaveText('Изделие 1');
  await expect(inspector).toContainText('Размер раскроя');
});

test('щелчок мимо изделия снимает выделение', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByLabel('Свойства объекта')).toContainText('Размер раскроя');

  // Угол холста — заведомо пустое место.
  await page.mouse.click(box.x + 6, box.y + 6);
  await expect(page.getByLabel('Свойства объекта').getByRole('heading')).toHaveText('Изделие 1');
});

test('вращение меняет картинку и не меняет выделение (§18)', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.click(cx, cy);
  const selectedBefore = await page.getByLabel('Свойства объекта').getByRole('heading').textContent();

  const before = await canvas.screenshot();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy + 40, { steps: 8 });
  await page.mouse.up();
  const after = await canvas.screenshot();

  // Картинка обязана измениться: иначе вращение «работает» только в коде.
  expect(Buffer.compare(before, after)).not.toBe(0);

  // Вращение — не выбор: протащить указатель по изделию и потерять
  // выделение было бы худшим видом сюрприза.
  await expect(page.getByLabel('Свойства объекта').getByRole('heading')).toHaveText(selectedBefore ?? '');
});

test('колесо меняет масштаб', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const box = (await canvas.boundingBox())!;
  const before = await canvas.screenshot();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(120);

  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
});

test('стандартные виды переключают камеру (§17)', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const perspective = await canvas.screenshot();

  await page.getByRole('radio', { name: 'Спереди' }).click();
  await page.waitForTimeout(150);
  const front = await canvas.screenshot();
  expect(Buffer.compare(perspective, front)).not.toBe(0);
  await expect(page.getByRole('radio', { name: 'Спереди' })).toBeChecked();

  await page.getByRole('radio', { name: 'Сверху' }).click();
  await page.waitForTimeout(150);
  expect(Buffer.compare(front, await canvas.screenshot())).not.toBe(0);
});

test('перетаскивание ручки меняет ширину одной командой (§22–§24)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Спереди' }).click();
  await page.waitForTimeout(150);

  const widthField = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await expect(widthField).toHaveValue('1000');

  const box = (await canvasOf(page).boundingBox())!;
  // Правая грань изделия в виде спереди: измерено на настоящей сцене,
  // полоса захвата занимает 0.63…0.68 ширины холста.
  const x = box.x + box.width * 0.655;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });

  // Во время жеста домен не трогается: поле ещё показывает старое
  // значение, а на сцене виден числовой отсчёт (§24).
  await expect(widthField).toHaveValue('1000');
  await expect(page.getByText(/^Ширина \d+ мм$/)).toBeVisible();

  await page.mouse.up();

  const after = await widthField.inputValue();
  expect(Number(after)).toBeGreaterThan(1000);

  // Один жест — один шаг истории.
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(widthField).toHaveValue('1000');
});

test('Esc отменяет жест ручки до отпускания', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Спереди' }).click();
  await page.waitForTimeout(150);

  const box = (await canvasOf(page).boundingBox())!;
  const x = box.x + box.width * 0.655;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 6 });
  await expect(page.getByText(/^Ширина \d+ мм$/)).toBeVisible();

  await page.keyboard.press('Escape');
  await page.mouse.up();

  await expect(page.getByRole('spinbutton', { name: 'Ширина', exact: true })).toHaveValue('1000');
  await expect(page.getByRole('button', { name: 'Отменить' })).toBeDisabled();
});

test('сцена захватывает указатель на время жеста (§18)', async ({ page }) => {
  await page.goto('/');

  const captured = await page.evaluate(() => {
    const host = document.querySelector('canvas')?.parentElement;
    if (!(host instanceof HTMLElement)) return null;
    const rect = host.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const options = { pointerId: 7, pointerType: 'mouse', clientX: x, clientY: y, bubbles: true, isPrimary: true };

    let seen = false;
    const original = host.setPointerCapture.bind(host);
    host.setPointerCapture = (id: number): void => {
      seen = true;
      // Настоящий захват в синтетическом событии браузер не даёт: важно,
      // что рендерер его запрашивает, а не то, что jsdom его выдал.
      try {
        original(id);
      } catch {
        /* ожидаемо для синтетического указателя */
      }
    };
    host.dispatchEvent(new PointerEvent('pointerdown', options));
    host.dispatchEvent(new PointerEvent('pointerup', options));
    return seen;
  });

  expect(captured).toBe(true);
});

test('два пальца масштабируют сцену и не выбирают деталь (§33)', async ({ page }) => {
  await page.goto('/');

  const canvas = canvasOf(page);
  const before = await canvas.screenshot();

  const changed = await page.evaluate(async () => {
    const host = document.querySelector('canvas')?.parentElement;
    if (!(host instanceof HTMLElement)) return false;
    const rect = host.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const send = (type: string, id: number, x: number, y: number): void => {
      host.dispatchEvent(
        new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }),
      );
    };

    send('pointerdown', 1, cx - 40, cy);
    send('pointerdown', 2, cx + 40, cy);
    for (let i = 1; i <= 6; i += 1) {
      send('pointermove', 1, cx - 40 - i * 12, cy);
      send('pointermove', 2, cx + 40 + i * 12, cy);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    send('pointerup', 1, cx - 112, cy);
    send('pointerup', 2, cx + 112, cy);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return true;
  });
  expect(changed).toBe(true);
  await page.waitForTimeout(150);

  // Масштаб изменился…
  expect(Buffer.compare(before, await canvas.screenshot())).not.toBe(0);
  // …а выделение — нет: щипок не должен подбирать деталь под пальцем.
  await expect(page.getByLabel('Свойства объекта').getByRole('heading')).toHaveText('Изделие 1');
});

test('размеры правятся без мыши: сцена не единственный способ управления (§34)', async ({ page }) => {
  await page.goto('/');

  const widthField = page.getByRole('spinbutton', { name: 'Ширина', exact: true });
  await widthField.fill('1450');
  await expect(widthField).toHaveValue('1450');

  // Сцена обязана отразить правку, сделанную с клавиатуры.
  await expect(canvasOf(page)).toHaveAttribute('aria-label', /ширина 1450/);
});

test('вид переключается между сценой и плоской схемой', async ({ page }) => {
  await page.goto('/');
  await expect(canvasOf(page)).toBeVisible();

  await page.getByRole('radio', { name: 'Схема' }).click();
  await expect(canvasOf(page)).toHaveCount(0);
  await expect(page.getByRole('application', { name: /Схема изделия/ })).toBeVisible();

  await page.getByRole('radio', { name: 'Сцена' }).click();
  await expect(canvasOf(page)).toBeVisible();
});
