import { query, queryOne, transaction } from '../index.js';
import type { MapType } from '$lib/shared/types/index.js';

export async function createMap(
	projectId: string,
	userId: string,
	label: string,
	mapType: MapType,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'map.create', $2, $3) RETURNING id`,
			[projectId, userId, JSON.stringify({ label, mapType })]
		);

		const props = { mapType, ...properties };
		const elemRes = await client.query(
			`INSERT INTO elements (project_id, kind, label, constituted_by, properties)
			 VALUES ($1, 'map', $2, $3, $4) RETURNING *`,
			[projectId, label, eventRes.rows[0].id, JSON.stringify(props)]
		);
		return elemRes.rows[0];
	});
}

export async function getMapsByProject(projectId: string) {
	return (
		await query(
			`SELECT * FROM elements
			 WHERE project_id = $1 AND kind = 'map' AND deleted_at IS NULL
			 ORDER BY created_at DESC`,
			[projectId]
		)
	).rows;
}

export async function getMap(mapId: string, projectId: string) {
	return queryOne(
		`SELECT * FROM elements WHERE id = $1 AND project_id = $2 AND kind = 'map' AND deleted_at IS NULL`,
		[mapId, projectId]
	);
}

export async function getMapElements(mapId: string, projectId: string) {
	// Get all elements that have aspects on this map (i.e. placed on map)
	return (
		await query(
			`SELECT e.*, ea.properties as aspect_properties
			 FROM element_aspects ea
			 JOIN elements e ON e.id = ea.element_id
			 WHERE ea.context_id = $1 AND e.project_id = $2 AND e.deleted_at IS NULL
			 ORDER BY e.created_at`,
			[mapId, projectId]
		)
	).rows;
}

export async function getMapRelations(mapId: string, projectId: string) {
	// Get relations whose source and target are both placed on this map
	return (
		await query(
			`SELECT r.*, ea.properties as aspect_properties,
			        s_asp.properties as source_aspect, t_asp.properties as target_aspect
			 FROM elements r
			 JOIN element_aspects ea ON ea.element_id = r.id AND ea.context_id = $1
			 LEFT JOIN element_aspects s_asp ON s_asp.element_id = r.source_id AND s_asp.context_id = $1
			 LEFT JOIN element_aspects t_asp ON t_asp.element_id = r.target_id AND t_asp.context_id = $1
			 WHERE r.project_id = $2 AND r.kind = 'relation' AND r.deleted_at IS NULL`,
			[mapId, projectId]
		)
	).rows;
}
