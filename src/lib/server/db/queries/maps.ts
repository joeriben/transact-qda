import { query, queryOne, transaction } from '../index.js';
import type { MapType } from '$lib/shared/types/index.js';

// A map IS a naming that serves as a perspective.
// Everything "on the map" has an appearance from this perspective.

export async function createMap(
	projectId: string,
	userId: string,
	label: string,
	mapType: MapType,
	properties?: Record<string, unknown>
) {
	return transaction(async (client) => {
		// The map is a naming
		const mapRes = await client.query(
			`INSERT INTO namings (project_id, inscription, created_by)
			 VALUES ($1, $2, $3) RETURNING *`,
			[projectId, label, userId]
		);
		const map = mapRes.rows[0];

		// It appears as a perspective FROM ITSELF (self-referential)
		await client.query(
			`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
			 VALUES ($1, $1, 'perspective', $2)`,
			[map.id, JSON.stringify({ mapType, ...properties })]
		);

		return { ...map, properties: { mapType, ...properties } };
	});
}

export async function getMapsByProject(projectId: string) {
	return (
		await query(
			`SELECT n.id, n.inscription as label, n.created_at, a.properties
			 FROM namings n
			 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
			 WHERE n.project_id = $1 AND n.deleted_at IS NULL
			   AND a.mode = 'perspective'
			   AND a.properties ? 'mapType'
			 ORDER BY n.created_at DESC`,
			[projectId]
		)
	).rows;
}

export async function getMap(mapId: string, projectId: string) {
	return queryOne(
		`SELECT n.id, n.inscription as label, n.created_at, a.properties
		 FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL
		   AND a.mode = 'perspective'`,
		[mapId, projectId]
	);
}

export async function getMapAppearances(mapId: string, projectId: string) {
	// Everything that appears from this map-as-perspective
	return (
		await query(
			`SELECT a.*, n.inscription, n.created_at as naming_created_at
			 FROM appearances a
			 JOIN namings n ON n.id = a.naming_id
			 WHERE a.perspective_id = $1
			   AND a.naming_id != $1
			   AND n.project_id = $2
			   AND n.deleted_at IS NULL
			 ORDER BY n.seq`,
			[mapId, projectId]
		)
	).rows;
}
