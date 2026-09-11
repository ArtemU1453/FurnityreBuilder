/** Типы структурной описи .xlsx (PROMPT 66 §1). Вне продуктового слоя. */
export interface XlsxCell {
  readonly ref: string;
  readonly row: number;
  readonly column: number;
  readonly type: string;
  readonly value: string | null;
  readonly formula: string | null;
  readonly rowHidden: boolean;
}
export interface XlsxSheet {
  readonly name: string;
  readonly state: string;
  readonly part: string | null;
  readonly dimension: string | null;
  readonly maxRow: number;
  readonly maxColumn: number;
  readonly nonEmptyCells: number;
  readonly cells: readonly XlsxCell[];
  readonly formulas: readonly string[];
  readonly mergedRanges: readonly string[];
  readonly hiddenRows: readonly number[];
  readonly hiddenColumns: readonly string[];
  readonly freezePanes: string | null;
  readonly autoFilter: string | null;
  readonly dataValidations: number;
  readonly conditionalFormatting: number;
  readonly hyperlinks: number;
  readonly tableParts: number;
  readonly legacyDrawing: boolean;
  readonly drawing: boolean;
  readonly relatedParts: readonly string[];
}
export interface XlsxInventory {
  readonly parts: readonly { readonly name: string; readonly size: number }[];
  readonly creator: string | null;
  readonly lastModifiedBy: string | null;
  readonly title: string | null;
  readonly subject: string | null;
  readonly created: string | null;
  readonly modified: string | null;
  readonly application: string | null;
  readonly appVersion: string | null;
  readonly company: string | null;
  readonly sharedStringCount: number;
  readonly definedNames: readonly { readonly name: string | null; readonly value: string }[];
  readonly externalReferences: number;
  readonly customXml: readonly string[];
  readonly embeddedObjects: readonly string[];
  readonly macros: boolean;
  readonly sheets: readonly XlsxSheet[];
}
export function readPackage(path: string): Map<string, Buffer>;
export function inventoryXlsx(path: string): XlsxInventory;
