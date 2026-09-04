import type { Furniture, Project } from '../domain/index.js';
import type { ProjectFingerprint } from './types.js';

/**
 * Отпечаток производственного входа (PROMPT 21 §10–§11).
 *
 * ## Зачем он нужен, если расчёт производный
 *
 * Производственный пакет — снимок: его сохраняют, печатают, передают в
 * цех. Проект после этого продолжают править. Отпечаток отвечает на
 * единственный вопрос: «этот пакет всё ещё описывает то изделие?» — и
 * отвечает точно, а не «кажется, ничего не менялось».
 *
 * ## Что в него входит
 *
 * Всё, от чего зависит производственный расчёт (§11): габариты, корпус,
 * дерево секций с наполнением, фасады, реестр материалов и настройки
 * проекта. И НЕ входит то, от чего он не зависит: имя проекта, время
 * изменения, версия приложения. Переименование не должно объявлять
 * напечатанный пакет устаревшим — иначе предупреждение об устаревании
 * перестанут читать.
 *
 * ## Почему сериализация, а не хеш
 *
 * Хеш требует выбора хеш-функции и даёт коллизии, а выигрыш — только в
 * длине строки, которая никому не показывается. Отпечаток — это
 * детерминированная сериализация значимых полей: одинаковый вход даёт
 * одинаковую строку, разный — разную, и это доказуемо, а не вероятно.
 */

function furniturePart(furniture: Furniture): unknown {
  return {
    id: furniture.id,
    kind: furniture.kind,
    dimensions: furniture.dimensions,
    carcass: furniture.carcass,
    root: furniture.root,
    facades: furniture.facades,
    // `name` намеренно отсутствует: переименование изделия не меняет ни
    // одной детали, ни одного отверстия и ни одного листа раскроя.
  };
}

export function fingerprintOf(project: Project): ProjectFingerprint {
  return JSON.stringify({
    furniture: project.furniture.map(furniturePart),
    materials: project.materials,
    hardware: project.hardware,
    settings: project.settings,
  });
}

/** Совпадает ли отпечаток пакета с текущим состоянием проекта. */
export function matchesProject(fingerprint: ProjectFingerprint, project: Project): boolean {
  return fingerprint === fingerprintOf(project);
}
