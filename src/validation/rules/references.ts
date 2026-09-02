import type { Issue, NodeId, Project } from '../../domain/index.js';
import { collectNodeIds, isValidId, issue, visitNodes } from '../../domain/index.js';
import type { ValidationRule } from '../types.js';

/**
 * Ссылочная целостность и уникальность идентификаторов.
 *
 * Битая ссылка не «просто не отрисуется»: она уронит расчёт или, что хуже,
 * тихо выпадет из деталировки. Дешевле поймать её здесь.
 */
export const referencesRule: ValidationRule = {
  code: 'REFERENCES',
  run(project: Project): Issue[] {
    const issues: Issue[] = [];
    const materialIds = new Set(Object.keys(project.materials.items));

    if (!isValidId(project.id)) {
      issues.push(issue('ID_INVALID', 'error', 'Идентификатор проекта имеет недопустимый формат.', { path: 'id' }));
    }

    for (const [role, materialId] of Object.entries(project.materials.assignment)) {
      if (materialId !== undefined && !materialIds.has(materialId)) {
        issues.push(
          issue(
            'MATERIAL_REFERENCE_BROKEN',
            'error',
            `Роль «${role}» ссылается на несуществующий материал.`,
            { path: `materials.assignment.${role}` },
          ),
        );
      }
    }

    if (!materialIds.has(project.settings.defaultMaterialId)) {
      issues.push(
        issue('MATERIAL_REFERENCE_BROKEN', 'error', 'Материал проекта по умолчанию не найден в библиотеке.', {
          path: 'settings.defaultMaterialId',
        }),
      );
    }

    project.furniture.forEach((furniture, fi) => {
      const base = `furniture.${String(fi)}`;

      if (!isValidId(furniture.id)) {
        issues.push(issue('ID_INVALID', 'error', 'Идентификатор изделия недопустим.', { path: `${base}.id` }));
      }

      // Уникальность идентификаторов узлов внутри изделия.
      const seen = new Set<NodeId>();
      visitNodes(furniture.root, (node) => {
        if (!isValidId(node.id)) {
          issues.push(
            issue('ID_INVALID', 'error', 'Идентификатор узла секции недопустим.', {
              nodeId: node.id,
            }),
          );
        }
        if (seen.has(node.id)) {
          issues.push(
            issue('NODE_ID_DUPLICATE', 'error', 'Повторяющийся идентификатор узла секции.', {
              nodeId: node.id,
            }),
          );
        }
        seen.add(node.id);
      });

      if (!materialIds.has(furniture.carcass.back.materialId)) {
        issues.push(
          issue('MATERIAL_REFERENCE_BROKEN', 'error', 'Материал задней стенки не найден в библиотеке.', {
            path: `${base}.carcass.back.materialId`,
          }),
        );
      }

      const nodeIds = new Set(collectNodeIds(furniture.root));
      furniture.facades.forEach((facade, gi) => {
        if (facade.covers.kind === 'node' && !nodeIds.has(facade.covers.nodeId)) {
          issues.push(
            issue(
              'FACADE_REFERENCE_BROKEN',
              'error',
              'Фасад ссылается на несуществующую секцию.',
              { path: `${base}.facades.${String(gi)}.covers.nodeId` },
            ),
          );
        }
      });
    });

    return issues;
  },
};
