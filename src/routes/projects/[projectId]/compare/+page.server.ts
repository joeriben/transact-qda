import type { PageServerLoad } from './$types.js';
import { getDocNetsByProject, getDocNetGroundedNamings } from '$lib/server/db/queries/docnets.js';
import { query } from '$lib/server/db/index.js';

export const load: PageServerLoad = async ({ params, url }) => {
	const [docnets, documents, maps] = await Promise.all([
		getDocNetsByProject(params.projectId),
		query(
			`SELECT n.id, n.inscription as label
			 FROM namings n
			 JOIN document_content dc ON dc.naming_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			 ORDER BY n.inscription`,
			[params.projectId]
		).then(r => r.rows),
		query(
			`SELECT n.id, n.inscription as label, a.properties->>'mapType' as map_type
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id AND a.mode = 'perspective'
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.properties ? 'mapType'
			 ORDER BY n.inscription`,
			[params.projectId]
		).then(r => r.rows)
	]);

	// If two sources are selected via query params, compute comparison
	const sourceA = url.searchParams.get('a');
	const sourceB = url.searchParams.get('b');
	const typeA = url.searchParams.get('typeA') || 'docnet';
	const typeB = url.searchParams.get('typeB') || 'docnet';

	let comparison = null;

	if (sourceA && sourceB) {
		const [namingsA, namingsB] = await Promise.all([
			getNamingsForSource(typeA, sourceA, params.projectId),
			getNamingsForSource(typeB, sourceB, params.projectId)
		]);

		const setA = new Map(namingsA.map((n: any) => [n.id, n]));
		const setB = new Map(namingsB.map((n: any) => [n.id, n]));

		const shared = namingsA.filter((n: any) => setB.has(n.id));
		const onlyA = namingsA.filter((n: any) => !setB.has(n.id));
		const onlyB = namingsB.filter((n: any) => !setA.has(n.id));

		comparison = { shared, onlyA, onlyB, sourceA, sourceB, typeA, typeB };
	}

	return { docnets, documents, maps, comparison, projectId: params.projectId };
};

async function getNamingsForSource(type: string, sourceId: string, projectId: string) {
	switch (type) {
		case 'docnet':
			return getDocNetGroundedNamings(sourceId, projectId);
		case 'document':
			return (await query(
				`SELECT DISTINCT code.id, code.inscription as label
				 FROM appearances ann
				 JOIN namings ann_n ON ann_n.id = ann.naming_id AND ann_n.deleted_at IS NULL
				 JOIN namings code ON code.id = ann.directed_from AND code.deleted_at IS NULL
				 WHERE ann.directed_to = $1 AND ann.valence = 'codes'
				   AND ann_n.project_id = $2
				 ORDER BY code.inscription`,
				[sourceId, projectId]
			)).rows;
		case 'map':
			return (await query(
				`SELECT DISTINCT n.id, n.inscription as label
				 FROM appearances a
				 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL
				 WHERE a.perspective_id = $1 AND a.mode = 'entity'
				   AND n.project_id = $2
				 ORDER BY n.inscription`,
				[sourceId, projectId]
			)).rows;
		default:
			return [];
	}
}
