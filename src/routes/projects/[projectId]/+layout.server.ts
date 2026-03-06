import type { LayoutServerLoad } from './$types.js';
import { queryOne } from '$lib/server/db/index.js';
import { error } from '@sveltejs/kit';

export const load: LayoutServerLoad = async ({ params, locals }) => {
	const project = await queryOne<{ id: string; name: string; description: string | null; role: string }>(
		`SELECT p.id, p.name, p.description, pm.role
		 FROM projects p
		 JOIN project_members pm ON pm.project_id = p.id
		 WHERE p.id = $1 AND pm.user_id = $2`,
		[params.projectId, locals.user!.id]
	);

	if (!project) {
		error(404, 'Project not found');
	}

	// Count documents (namings with document_content)
	// Count codes (namings appearing as entity in code-system perspective)
	// Count maps (namings appearing as perspective with mapType)
	// Count memos (namings with memo_content)
	const counts = await queryOne<{ documents: string; codes: string; maps: string; memos: string }>(
		`SELECT
			(SELECT COUNT(*) FROM document_content dc
			 JOIN namings n ON n.id = dc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as documents,
			(SELECT COUNT(*) FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.mode = 'entity'
			   AND a.perspective_id IN (
			     SELECT n2.id FROM namings n2
			     JOIN appearances a2 ON a2.naming_id = n2.id AND a2.perspective_id = n2.id
			     WHERE n2.project_id = $1 AND a2.properties->>'role' = 'code-system'
			   )) as codes,
			(SELECT COUNT(*) FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.naming_id = a.perspective_id
			   AND a.mode = 'perspective' AND a.properties ? 'mapType') as maps,
			(SELECT COUNT(*) FROM memo_content mc
			 JOIN namings n ON n.id = mc.naming_id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL) as memos`,
		[params.projectId]
	);

	return {
		project,
		counts: {
			documents: parseInt(counts?.documents || '0'),
			codes: parseInt(counts?.codes || '0'),
			maps: parseInt(counts?.maps || '0'),
			memos: parseInt(counts?.memos || '0')
		}
	};
};
