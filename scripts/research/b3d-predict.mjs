#!/usr/bin/env node
/**
 * Предсказания конкурирующих гипотез PM-17 (второй промпт о .b3d, §D).
 *
 * НЕ продуктовый код. Ничего из `src/` не импортирует.
 *
 * Зачем: гипотезы о шаге крепления задней стенки должны различаться ДО
 * появления второго образца, а не подгоняться под него задним числом.
 * Скрипт печатает, что каждая гипотеза предсказывает для изделия B,
 * деталировка которого уже известна (карта раскроя приложена), но
 * спецификации фурнитуры для которого нет.
 *
 * Совпадение факта с одной из строк таблицы и будет различением.
 */

/** Изделие A — образец 1, разобран. Изделие B — только карта раскроя. */
const A = {
  name: 'A (разобран)',
  cabinet: { width: 1240, height: 2100 },
  back: { width: 1236, height: 2096, panels: 5 },
  bays: 2, bayWidth: 596, verticals: 3, shelfLevels: 4,
  observed: 125, observedPlaced: 120,
};
const B = {
  name: 'B (только раскрой)',
  cabinet: { width: 632, height: 1840 },
  back: { width: 628, height: 1836, panels: 1 },
  bays: 2, bayWidth: 292, verticals: 3, shelfLevels: 4,
  observed: null, observedPlaced: null,
};

const SHEET_HDF = { width: 2800, height: 2070 };

/** Точек на одной горизонтальной линии: по PITCH внутри отсека + по вертикали. */
function pointsPerHorizontal(p, pitch) {
  const perBay = Math.floor((p.bayWidth - 1) / pitch) + 1;
  return perBay * p.bays + (p.verticals - 2);
}

const HYPOTHESES = [
  {
    id: 'H1', title: 'единый шаг 100 мм по всему контуру, включая внутренние линии',
    predict(p) {
      const horizontals = p.shelfLevels + 2;
      const h = horizontals * (Math.floor((p.back.width - 1) / 100) + 1);
      const v = 2 * (Math.floor((p.back.height - 1) / 100) + 1);
      return h + v;
    },
  },
  {
    id: 'H2', title: 'фиксированное число на панель (24), как наблюдалось у A',
    predict(p) { return 24 * p.back.panels; },
  },
  {
    id: 'H3', title: 'шаг по внешнему периметру панели (опровергнута образцом A)',
    predict(p) { return Math.floor(2 * (p.back.width + p.back.height) / 132); },
  },
  {
    id: 'H5', title: 'гибрид: ряды по горизонталям шагом 100 + 1 точка между ними на каждом краю',
    predict(p) {
      const horizontals = p.shelfLevels + 2;
      const rows = horizontals * pointsPerHorizontal(p, 100);
      const extra = (horizontals - 1) * 2;
      return rows + extra;
    },
  },
];

function fits(back) {
  return (back.width <= SHEET_HDF.width && back.height <= SHEET_HDF.height)
    || (back.height <= SHEET_HDF.width && back.width <= SHEET_HDF.height);
}

console.log('=== проверка объяснения «сегментация из-за размера листа» ===');
for (const p of [A, B]) {
  console.log(`  ${p.name}: цельная панель ${p.back.width} × ${p.back.height}, ` +
    `лист ${SHEET_HDF.width} × ${SHEET_HDF.height} → ${fits(p.back) ? 'ПОМЕЩАЕТСЯ' : 'НЕ ПОМЕЩАЕТСЯ'}; ` +
    `фактически панелей: ${String(p.back.panels)}`);
}
console.log('  ВЫВОД: объяснение ОТВЕРГНУТО — обе панели помещаются на лист целиком');
console.log('  (у A — с поворотом: 2096 ≤ 2800 и 1236 ≤ 2070), а разрезана только A.');

console.log('\n=== структура раскладки A, измеренная по координатам ===');
const A_ROWS = 2 * A.back.panels;            // по два горизонтальных ряда на панель
const A_PER_ROW = 11;                        // измерено
const A_EDGE_EXTRA = 2 * A.back.panels;      // по одной средней точке на каждый край панели
console.log(`  горизонтальных рядов: ${String(A_ROWS)}, точек в ряду: ${String(A_PER_ROW)}, ` +
  `средних точек на краях: ${String(A_EDGE_EXTRA)}`);
console.log(`  итого: ${String(A_ROWS * A_PER_ROW + A_EDGE_EXTRA)} — совпадает с 120 размещёнными`);

console.log('\n=== предсказания гипотез PM-17 ===');
console.log('  гипотеза  A (факт 120 размещённых)   B (неизвестно)');
for (const h of HYPOTHESES) {
  const a = h.predict(A), b = h.predict(B);
  const mark = a === A.observedPlaced ? ' ← СУММА сходится с A' : '';
  console.log(`  ${h.id}  A=${String(a).padStart(4)}   B=${String(b).padStart(4)}   ${h.title}${mark}`);
}
console.log('\n  ВНИМАНИЕ: совпадение СУММЫ не означает совпадения СТРУКТУРЫ.');
console.log(`  H1 предсказывает ${String(Math.floor((A.back.width - 1) / 100) + 1)} точек в горизонтальном ряду; ` +
  `измерено ${String(A_PER_ROW)}. H1 опровергнута координатами, несмотря на верную сумму.`);
console.log('  Различение по образцу B: любая величина, отличная от предсказаний');
console.log('  остальных строк, однозначно указывает на одну гипотезу.');
