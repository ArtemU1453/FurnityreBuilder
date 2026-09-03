import type { IdFactory, ProjectId, WallId } from '../ids.js';
import type { Mm } from '../units.js';
import type { EdgeSpec, EdgeSizingPolicy, MaterialLibrary } from '../materials/types.js';
import type { CuttingSettings } from '../cutting/types.js';
import type { HardwareLibrary } from '../hardware/types.js';
import type { ConstructionScheme, Furniture, Tolerances } from '../furniture/types.js';

/**
 * Версия схемы сохранённого документа.
 *
 * Увеличивается при любом несовместимом изменении структуры. Каждое увеличение
 * сопровождается миграцией в src/persistence/migrations — см.
 * docs/REPOSITORY_ARCHITECTURE.md §5.
 */
export const SCHEMA_VERSION = 1;

export interface Wall {
  readonly id: WallId;
  readonly a: { readonly x: Mm; readonly z: Mm };
  readonly b: { readonly x: Mm; readonly z: Mm };
  readonly thickness: Mm;
  readonly height: Mm;
}

export interface Room {
  readonly walls: readonly Wall[];
  readonly ceilingHeight: Mm;
}

export interface ProjectSettings {
  readonly defaultMaterialId: string;
  readonly defaultEdge: EdgeSpec;
  readonly construction: ConstructionScheme;
  readonly tolerances: Tolerances;
  readonly edgeSizing: EdgeSizingPolicy;
  /**
   * Параметры раскроя (PROMPT 17). Ввод пользователя, а не производная
   * величина: сам раскрой не хранится и пересчитывается из деталей.
   */
  readonly cutting: CuttingSettings;
}

/**
 * Метаданные документа. Сознательно не содержат ничего, что идентифицирует
 * пользователя: продукт работает без регистрации, аккаунтов и трекинга
 * (docs/DATA_MODEL.md §16).
 */
export interface ProjectMetadata {
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appVersion: string;
}

export interface Project {
  readonly id: ProjectId;
  readonly name: string;
  readonly units: 'mm';
  readonly metadata: ProjectMetadata;
  readonly materials: MaterialLibrary;
  readonly hardware: HardwareLibrary;
  /** Сейчас одно изделие; массив — задел под планировщик. */
  readonly furniture: readonly Furniture[];
  readonly room?: Room;
  readonly settings: ProjectSettings;
}

/**
 * Сохраняемая единица. Версия лежит СНАРУЖИ проекта, а не внутри:
 * читатель обязан узнать версию до того, как начнёт разбирать содержимое.
 */
export interface ProjectDocument {
  readonly schemaVersion: number;
  readonly project: Project;
}

export interface CreateProjectOptions {
  readonly ids: IdFactory;
  readonly now: () => string;
  readonly appVersion: string;
  readonly name?: string;
}
