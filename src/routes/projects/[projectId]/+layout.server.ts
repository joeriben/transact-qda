import type { LayoutServerLoad } from './$types.js';
import { queryOne, query } from '$lib/server/db/index.js';
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

	const counts = await queryOne<{ documents: string; codes: string; maps: string; memos: string }>(
		`SELECT
			COUNT(*) FILTER (WHERE kind = 'document') as documents,
			COUNT(*) FILTER (WHERE kind = 'code' OR kind = 'category') as codes,
			COUNT(*) FILTER (WHERE kind = 'map') as maps,
			COUNT(*) FILTER (WHERE kind = 'memo') as memos
		 FROM elements
		 WHERE project_id = $1 AND deleted_at IS NULL`,
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
