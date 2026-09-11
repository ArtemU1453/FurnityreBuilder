import type { ProductionRuleReadiness } from './types.js';

/**
 * Реестр готовности четырёх производственных правил (PROMPT 65 §4).
 *
 * Здесь нет выводов — здесь перечислено, ЧТО наблюдалось, откуда и в
 * какой области. Решение считает `deriveDecision`, и поменять его,
 * не добавив доказательства, невозможно.
 *
 * Каждая запись ссылается на документ, где разбор приведён целиком.
 * Дублировать разбор сюда нельзя: два текста об одном расходятся.
 */
export const READINESS_REGISTRY: readonly ProductionRuleReadiness[] = [
  {
    id: 'PM-18',
    title: 'Корпусный крепёж',
    question:
      'Какой крепёж и в каком количестве получает стык корпуса в зависимости от его вида и длины.',
    applicability: 'applicable',
    unknownIds: ['T-HW-03'],
    evidence: [
      {
        id: 'PM-18/b3d-two-per-joint',
        statement:
          'В изделии A на стыке накладного горизонта с вертикалью корпуса стоит ровно 2 конфирмата, без исключений.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/B3D_PM18_PM17_EVIDENCE.md',
      },
      {
        id: 'PM-18/b3d-systems-disjoint',
        statement:
          'Конфирмат, рафикс и минификс занимают в изделии A непересекающиеся области: ни один накладной горизонт не получил рафикс, ни один минификс не попал в корпус.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/B3D_PM18_PM17_EVIDENCE.md',
      },
      {
        id: 'PM-18/xlsx-counts',
        statement:
          'Спецификация заказа 52987: конфирмат 28, рафикс 48, минификс 40 — на одном изделии одновременно.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/HARDWARE_RULE_SOURCE_VERIFICATION.md',
      },
      {
        id: 'PM-18/official-two-confirmats',
        statement:
          'Официальная страница сборки (в пересказе поискового индекса): основание и боковина соединяются двумя конфирматами.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'supported',
        level: 'L1',
        document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-18/official-eccentric-instead',
        statement:
          'Та же страница (в пересказе): для небольших шкафов до 1500 мм эксцентриковые стяжки применяют ВМЕСТО конфирматов.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'contradicted',
        level: 'L1',
        document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
      },
    ],
    contradictions: [
      {
        id: 'PM-18/eccentric-versus-mixed-fastening',
        between: ['PM-18/official-eccentric-instead', 'PM-18/xlsx-counts'],
        classification: 'directly-disproved',
        summary:
          'Изделие A шириной 1240 мм содержит конфирматы И эксцентриковые системы одновременно, по разным видам стыков. «Вместо» не наблюдается.',
        document: 'docs/PM18_OFFICIAL_SOURCE_ANALYSIS.md',
      },
    ],
    unresolvedVariables: [
      'какой вид стыка получает какую систему в общем случае',
      'зависит ли количество крепежа от длины стыка',
      'координаты присадки крепежа',
      'правило для стыков, которых в изделии A нет: двери, цоколь, столешница',
    ],
    declaredBlockers: ['insufficient-independent-cases', 'missing-algorithm'],
    nextEvidence: [
      {
        id: 'PM-18/next-second-joint-length',
        requirement:
          'Карта крепежа второго изделия, где длина стыка «накладной горизонт ↔ вертикаль» отличается от 1240 мм минимум на 300 мм. Если и там ровно 2 — количество от длины не зависит; если больше — зависимость становится измеримой.',
        wouldResolve: [
          'insufficient-independent-cases',
          'missing-algorithm',
          'product-specific-evidence-only',
        ],
        necessity: 'minimum',
      },
      {
        id: 'PM-18/next-verbatim-assembly',
        requirement:
          'Дословный текст страницы сборки или схема сборки, приходящая с заказом: источник сам называет её местом, где напечатаны количества. Она же разрешит противоречие про эксцентрики «вместо» конфирматов.',
        wouldResolve: ['conflicting-evidence', 'source-level-l1-only'],
        necessity: 'minimum',
      },
      {
        id: 'PM-18/next-third-order',
        requirement:
          'Третий заказ с дверями или цоколем — видами стыков, которых в изделии A нет вовсе.',
        wouldResolve: ['missing-algorithm'],
        necessity: 'useful',
      },
    ],
  },

  {
    id: 'PM-17',
    title: 'Крепление задней стенки',
    question: 'Сколько крепежа и в каких точках получает задняя стенка.',
    applicability: 'applicable',
    unknownIds: ['T-HW-03', 'T-BACK-01'],
    evidence: [
      {
        id: 'PM-17/b3d-internal-lines',
        statement:
          'Из 125 гвоздей изделия A 120 расставлены пространственно, и 51 из них лежит на внутренних линиях контакта (полки, перегородки). Модель «крепёж только по внешнему периметру» этим опровергнута.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/B3D_PM18_PM17_EVIDENCE.md',
      },
      {
        id: 'PM-17/xlsx-nails-and-clips',
        statement:
          'Спецификация заказа 52987: гвоздь толевый 2×20 — 125 шт и скрепка-крабик для ХДФ — 32 шт, на одном изделии.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/HARDWARE_RULE_SOURCE_VERIFICATION.md',
      },
      {
        id: 'PM-17/official-fasten-internal',
        statement:
          'Официальная инструкция (в пересказе индекса) требует крепить заднюю стенку не только к боковинам, но и ко всем внутренним неразборным деталям — полкам и перегородкам.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'supported',
        level: 'L1',
        document: 'docs/PM17_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-17/official-as-many-as-possible',
        statement:
          'Та же инструкция предписывает «как можно больше точек контакта». Это не исполнимая формула: шага в миллиметрах она не задаёт.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'indistinguishable',
        level: 'L1',
        document: 'docs/PM17_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-17/four-hypotheses-alive',
        statement:
          'Четыре предрегистрированные гипотезы расстановки (предсказания 80, 24, 37, 52 для изделия B) остаются неразличёнными: ни одна не исключена ни вторым образцом, ни официальным текстом.',
        sourceType: 'inference',
        scope: 'unresolved',
        status: 'indistinguishable',
        level: 'L1',
        document: 'docs/PM17_PRODUCT_B_EVIDENCE_SEARCH.md',
      },
      {
        id: 'PM-17/sheet-screw-claim',
        statement:
          'Приложенный справочник фурнитуры утверждает, что задние стенки ХДФ/ДВП крепят мебельным саморезом.',
        sourceType: 'unknown',
        scope: 'unresolved',
        status: 'contradicted',
        level: 'L1',
        document: 'docs/HARDWARE_REFERENCE_EVIDENCE_VERIFICATION.md',
      },
    ],
    contradictions: [
      {
        id: 'PM-17/screw-versus-nails',
        between: ['PM-17/sheet-screw-claim', 'PM-17/xlsx-nails-and-clips'],
        classification: 'directly-disproved',
        summary:
          'В заказе 52987 заднюю стенку держат гвозди и скрепки, а 40 саморезов подписаны «для направл/петля/ножки». У справочника, который утверждает обратное, нет происхождения.',
        document: 'docs/HARDWARE_REFERENCE_EVIDENCE_VERIFICATION.md',
      },
    ],
    unresolvedVariables: [
      'количество крепежа задней стенки',
      'существует ли шаг как проектная величина вообще',
      'правило деления задней стенки на несколько панелей',
      'чем применение гвоздя отличается от применения скобы',
    ],
    declaredBlockers: ['insufficient-independent-cases', 'missing-algorithm'],
    nextEvidence: [
      {
        id: 'PM-17/next-second-specification',
        requirement:
          'Спецификация фурнитуры второго изделия, у которого задняя стенка есть и её размеры известны. Число гвоздей в ней различает H2 (фиксированное число на панель) и H4 (ряды по горизонталям) — предсказания 24 и 52 не совпадают.',
        wouldResolve: [
          'insufficient-independent-cases',
          'missing-algorithm',
          'product-specific-evidence-only',
        ],
        necessity: 'minimum',
      },
      {
        id: 'PM-17/next-verbatim-back-panel-page',
        requirement:
          'Дословный текст официальной страницы о креплении задней стенки либо схема сборки из заказа: она же разрешит противоречие про саморез.',
        wouldResolve: ['conflicting-evidence', 'source-level-l1-only'],
        necessity: 'minimum',
      },
      {
        id: 'PM-17/next-panel-splitting-rule',
        requirement:
          'Объяснение, почему изделие A разрезано на 5 панелей задней стенки, а изделие B — на одну.',
        wouldResolve: ['missing-algorithm'],
        necessity: 'useful',
      },
    ],
  },

  {
    id: 'PM-06',
    title: 'Петли дверей',
    question: 'Сколько петель получает створка, какой модели, и где сверлятся отверстия.',
    applicability: 'applicable',
    unknownIds: ['T-HW-01', 'T-DOOR-05', 'T-DRILL-01'],
    evidence: [
      {
        id: 'PM-06/no-hinges-in-any-artifact',
        statement:
          'Ни в одном доступном производственном документе петель нет: ни в спецификации заказа 52987, ни в файле проекта, ни в карточках присадки. Изделий с распашным фасадом среди материалов нет.',
        sourceType: 'project-artifact-complete',
        scope: 'product-specific',
        status: 'unknown',
        level: 'L3',
        document: 'docs/PM06_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-06/official-category-exists',
        statement:
          'Категории «Петли и газлифты» и «нажимной механизм и петли tip-on» в конструкторе существуют — возможность подтверждена.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'supported',
        level: 'L2',
        document: 'docs/PM06_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-06/official-adjustment-only',
        statement:
          'Официальная инструкция описывает только регулировку: три плоскости, вертикаль в пределах 5 мм. Ни количества, ни модели, ни координат.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'supported',
        level: 'L1',
        document: 'docs/PM06_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-06/glass-door-threshold',
        statement:
          'Единственный найденный размерный порог — «не больше 35×35 см» — относится к СТЕКЛЯННЫМ дверям, а не к фасаду из ЛДСП.',
        sourceType: 'search-index',
        scope: 'product-specific',
        status: 'supported',
        level: 'L1',
        document: 'docs/PM06_OFFICIAL_SOURCE_ANALYSIS.md',
      },
      {
        id: 'PM-06/sheet-cup-35',
        statement:
          'Справочник фурнитуры называет диаметр чашки 35 мм и угол открывания 95°–110°, но у файла нет происхождения: автор — библиотека, заказа и изделия в свойствах нет.',
        sourceType: 'unknown',
        scope: 'unresolved',
        status: 'supported',
        level: 'L1',
        document: 'docs/HARDWARE_REFERENCE_XLSX_FORENSICS.md',
      },
    ],
    contradictions: [],
    unresolvedVariables: [
      'число петель на створку',
      'пороги по высоте, ширине или массе фасада',
      'модель и производитель петли',
      'глубина чашки',
      'отступ центра чашки от края створки',
      'отступ крайней петли от торца фасада',
      'межосевое расстояние отверстий ответной планки',
    ],
    declaredBlockers: ['missing-model-parameter', 'missing-algorithm', 'source-level-l1-only'],
    nextEvidence: [
      {
        id: 'PM-06/next-order-with-doors',
        requirement:
          'Любой производственный документ на изделие С РАСПАШНЫМ ФАСАДОМ: спецификация даёт число петель на створку, карточки присадки — координаты чашки и планки. Сегодня таких документов нет ни одного.',
        wouldResolve: [
          'missing-model-parameter',
          'missing-algorithm',
          'product-specific-evidence-only',
          'insufficient-independent-cases',
        ],
        necessity: 'minimum',
      },
      {
        id: 'PM-06/next-threshold-table',
        requirement:
          'Дословная официальная страница или монтажная инструкция производителя петли с таблицей «высота или масса фасада → число петель».',
        wouldResolve: ['source-level-l1-only', 'missing-algorithm'],
        necessity: 'minimum',
      },
      {
        id: 'PM-06/next-second-door-height',
        requirement:
          'Второе изделие с фасадом ДРУГОЙ высоты — иначе порог по высоте неотличим от постоянного числа.',
        wouldResolve: ['insufficient-independent-cases'],
        necessity: 'useful',
      },
    ],
  },

  {
    id: 'FR-04',
    title: 'Ящики: конструкция короба и выбор направляющей',
    question:
      'По какой формуле из проёма получаются размеры короба, фасада и номинал направляющей.',
    applicability: 'applicable',
    unknownIds: ['T-DRW-03', 'T-DRW-04', 'T-DRW-05', 'T-DRW-07'],
    evidence: [
      {
        id: 'FR-04/b3d-box-composition',
        statement:
          'Короб изделия A состоит из задней, двух боковых стенок и дна; отдельной передней стенки нет. Дно — плита 16 мм, не в пазу.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/B3D_DRAWER_EVIDENCE.md',
      },
      {
        id: 'FR-04/b3d-side-clearance-13',
        statement:
          'Боковой зазор между коробом и стенкой проёма — 13 мм с каждой стороны: проём 596, короб 570.',
        sourceType: 'project-artifact-complete',
        scope: 'single-dimensional-case',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/FR04_MULTI_DRAWER_EVIDENCE_ANALYSIS.md',
      },
      {
        id: 'FR-04/b3d-slide-mid-height',
        statement:
          'Направляющая стоит на середине высоты боковины короба (89.5 из 179) у всех четырёх ящиков.',
        sourceType: 'project-artifact-complete',
        scope: 'single-dimensional-case',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/FR04_MULTI_DRAWER_EVIDENCE_ANALYSIS.md',
      },
      {
        id: 'FR-04/b3d-four-drawers-one-case',
        statement:
          'Четыре ящика изделия A — четыре повторения ОДНОГО размерного случая: все количества совпадают, кроме высоты отсека (400 против 401).',
        sourceType: 'project-artifact-complete',
        scope: 'single-dimensional-case',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/FR04_MULTI_DRAWER_EVIDENCE_ANALYSIS.md',
      },
      {
        id: 'FR-04/b3d-exact-division-disproved',
        statement:
          'Лишний миллиметр отсека ушёл целиком в зазор между фасадами (3.0 против 4.0), а высота фасада осталась 196. Точное деление проёма без округления этим исключено; три кандидата остались неразличёнными.',
        sourceType: 'project-artifact-complete',
        scope: 'single-dimensional-case',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/FR04_MULTI_DRAWER_EVIDENCE_ANALYSIS.md',
      },
      {
        id: 'FR-04/slide-model-boyard-350',
        statement:
          'Направляющая изделия A — Boyard Master DB4504Zn/350, две на ящик, при глубине короба 369.',
        sourceType: 'project-artifact-complete',
        scope: 'single-project',
        status: 'confirmed',
        level: 'L3',
        document: 'docs/HARDWARE_RULE_SOURCE_VERIFICATION.md',
      },
      {
        id: 'FR-04/official-facade-gap-2-4',
        statement:
          'Официальная страница (в пересказе): зазоры между фасадами делают 2–4 мм. Измеренные 3.0 и 4.0 попадают в диапазон, но диапазон не различает ни одного из трёх оставшихся кандидатов.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'indistinguishable',
        level: 'L1',
        document: 'docs/FR04_OFFICIAL_SOURCE_COMPARISON.md',
      },
      {
        id: 'FR-04/official-useful-depth-formula',
        statement:
          'Официальная формула полезной глубины (глубина − задняя стенка − фасад − 40) даёт для изделия A 341 мм и не воспроизводит ни один измеренный размер: 369, 353, 337, 350.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'contradicted',
        level: 'L1',
        document: 'docs/FR04_OFFICIAL_SOURCE_COMPARISON.md',
      },
      {
        id: 'FR-04/snippet-front-wall',
        statement:
          'Ранний поисковый сниппет утверждал, что короб ящика имеет переднюю стенку.',
        sourceType: 'search-index',
        scope: 'unresolved',
        status: 'contradicted',
        level: 'L1',
        document: 'docs/FR04_DRAWER_REFERENCE_EVIDENCE_UPDATE.md',
      },
    ],
    contradictions: [
      {
        id: 'FR-04/front-wall-versus-artifact',
        between: ['FR-04/snippet-front-wall', 'FR-04/b3d-box-composition'],
        classification: 'directly-disproved',
        summary:
          'Деталировка заказа и файл проекта содержат зад, две боковины и дно. Передней стенки нет ни в одной из 46 деталей.',
        document: 'docs/FR04_DRAWER_REFERENCE_EVIDENCE_UPDATE.md',
      },
      {
        id: 'FR-04/useful-depth-versus-measured',
        between: ['FR-04/official-useful-depth-formula', 'FR-04/b3d-box-composition'],
        classification: 'insufficient-information',
        summary:
          'Какую именно величину источник называет «полезной глубиной», он не уточняет. Ближайший измеренный размер (337) отличается на 4 мм. Сравнивать нечего: формула и измерения, возможно, про разные величины.',
        document: 'docs/FR04_OFFICIAL_SOURCE_COMPARISON.md',
      },
    ],
    unresolvedVariables: [
      'ряд номиналов направляющих и правило округления глубины',
      'высота боковины короба и её связь с высотой проёма',
      'вертикальное положение короба в проёме',
      'формула высоты фасада ящика',
      'универсальность бокового зазора 13 мм',
      'толщина и способ крепления дна в общем случае',
    ],
    declaredBlockers: ['missing-dimensional-variation', 'missing-algorithm'],
    nextEvidence: [
      {
        id: 'FR-04/next-second-drawer-geometry',
        requirement:
          'Заказ с ящиками ДРУГОЙ глубины и другой высоты проёма — минимум два новых размерных случая. Только вторая точка отличает «деление с остатком» от «пропорции с округлением» и показывает, постоянен ли зазор 13 мм.',
        wouldResolve: [
          'missing-dimensional-variation',
          'insufficient-independent-cases',
          'missing-algorithm',
          'product-specific-evidence-only',
        ],
        necessity: 'minimum',
      },
      {
        id: 'FR-04/next-nominal-length-series',
        requirement:
          'Дословный источник с рядом номиналов направляющих и правилом выбора по глубине: диапазон «250–600» рядом не является. Он же разрешит противоречие про переднюю стенку и полезную глубину.',
        wouldResolve: ['conflicting-evidence', 'source-level-l1-only', 'missing-algorithm'],
        necessity: 'minimum',
      },
      {
        id: 'FR-04/next-box-height-rule',
        requirement:
          'Третий заказ с ящиками другой высоты короба — подтвердил бы или опроверг «направляющая на середине высоты».',
        wouldResolve: ['missing-dimensional-variation'],
        necessity: 'useful',
      },
    ],
  },
];
