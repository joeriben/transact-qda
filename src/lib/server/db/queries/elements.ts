import { query, queryOne, transaction } from '../index.js';
import type { ElementKind } from '$lib/shared/types/index.js';

export async function createElement(
	projectId: string,
	userId: string,
	kind: ElementKind,
	label: string,
	opts?: { sourceId?: string; targetId?: string; properties?: Record<string, unknown> }
) {
	return transaction(async (client) => {
		// Create the constituting event
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'element.create', $2, $3) RETURNING id`,
			[projectId, userId, JSON.stringify({ kind, label })]
		);
		const eventId = eventRes.rows[0].id;

		// Create the element, constituted by that event
		const elemRes = await client.query(
			`INSERT INTO elements (project_id, kind, label, constituted_by, source_id, target_id, properties)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 RETURNING *`,
			[
				projectId,
				kind,
				label,
				eventId,
				opts?.sourceId || null,
				opts?.targetId || null,
				JSON.stringify(opts?.properties || {})
			]
		);

		return elemRes.rows[0];
	});
}

export async function updateElement(
	elementId: string,
	projectId: string,
	userId: string,
	updates: { label?: string; properties?: Record<string, unknown> }
) {
	return transaction(async (client) => {
		await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'element.update', $2, $3)`,
			[projectId, userId, JSON.stringify({ elementId, ...updates })]
		);

		const sets: string[] = [];
		const params: unknown[] = [];
		let idx = 1;

		if (updates.label !== undefined) {
			sets.push(`label = $${idx++}`);
			params.push(updates.label);
		}
		if (updates.properties !== undefined) {
			sets.push(`properties = properties || $${idx++}::jsonb`);
			params.push(JSON.stringify(updates.properties));
		}
		sets.push(`updated_at = now()`);

		params.push(elementId, projectId);
		const res = await client.query(
			`UPDATE elements SET ${sets.join(', ')}
			 WHERE id = $${idx++} AND project_id = $${idx}
			 RETURNING *`,
			params
		);
		return res.rows[0] ?? null;
	});
}

export async function softDeleteElement(elementId: string, projectId: string, userId: string) {
	return transaction(async (client) => {
		await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'element.delete', $2, $3)`,
			[projectId, userId, JSON.stringify({ elementId })]
		);

		await client.query(
			`UPDATE elements SET deleted_at = now() WHERE id = $1 AND project_id = $2`,
			[elementId, projectId]
		);
	});
}

export async function getElementsByProject(projectId: string, kind?: ElementKind) {
	if (kind) {
		return (
			await query(
				`SELECT * FROM elements WHERE project_id = $1 AND kind = $2 AND deleted_at IS NULL ORDER BY created_at`,
				[projectId, kind]
			)
		).rows;
	}
	return (
		await query(
			`SELECT * FROM elements WHERE project_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
			[projectId]
		)
	).rows;
}

export async function getElementById(elementId: string, projectId: string) {
	return queryOne(
		`SELECT * FROM elements WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
		[elementId, projectId]
	);
}

export async function createRelation(
	projectId: string,
	userId: string,
	sourceId: string,
	targetId: string,
	label: string,
	properties?: Record<string, unknown>
) {
	return createElement(projectId, userId, 'relation', label, {
		sourceId,
		targetId,
		properties
	});
}

export async function setAspect(
	elementId: string,
	contextId: string,
	projectId: string,
	userId: string,
	properties: Record<string, unknown>
) {
	return transaction(async (client) => {
		await client.query(
			`INSERT INTO events (project_id, type, created_by, context_id, data)
			 VALUES ($1, 'aspect.set', $2, $3, $4)`,
			[projectId, userId, contextId, JSON.stringify({ elementId, properties })]
		);

		const res = await client.query(
			`INSERT INTO element_aspects (element_id, context_id, properties)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (element_id, context_id)
			 DO UPDATE SET properties = element_aspects.properties || $3::jsonb, updated_at = now()
			 RETURNING *`,
			[elementId, contextId, JSON.stringify(properties)]
		);
		return res.rows[0];
	});
}

export async function getAspects(elementId: string) {
	return (
		await query(
			`SELECT ea.*, e.label as context_label, e.kind as context_kind
			 FROM element_aspects ea
			 JOIN elements e ON e.id = ea.context_id
			 WHERE ea.element_id = $1`,
			[elementId]
		)
	).rows;
}
