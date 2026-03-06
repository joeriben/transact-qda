import { query, queryOne, transaction } from '../index.js';

export async function createCode(
	projectId: string,
	userId: string,
	label: string,
	opts?: { color?: string; parentId?: string; description?: string }
) {
	return transaction(async (client) => {
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'code.create', $2, $3) RETURNING id`,
			[projectId, userId, JSON.stringify({ label, ...opts })]
		);

		const properties: Record<string, unknown> = {};
		if (opts?.color) properties.color = opts.color;
		if (opts?.description) properties.description = opts.description;

		const elemRes = await client.query(
			`INSERT INTO elements (project_id, kind, label, constituted_by, properties)
			 VALUES ($1, 'code', $2, $3, $4) RETURNING *`,
			[projectId, label, eventRes.rows[0].id, JSON.stringify(properties)]
		);

		if (opts?.parentId) {
			const maxPos = await client.query(
				`SELECT COALESCE(MAX(position), -1) + 1 as next_pos FROM code_hierarchy WHERE parent_id = $1`,
				[opts.parentId]
			);
			await client.query(
				`INSERT INTO code_hierarchy (parent_id, child_id, position) VALUES ($1, $2, $3)`,
				[opts.parentId, elemRes.rows[0].id, maxPos.rows[0].next_pos]
			);
		}

		return elemRes.rows[0];
	});
}

export async function getCodeTree(projectId: string) {
	const codes = await query(
		`SELECT e.*, ch.parent_id, ch.position
		 FROM elements e
		 LEFT JOIN code_hierarchy ch ON ch.child_id = e.id
		 WHERE e.project_id = $1 AND e.kind IN ('code', 'category') AND e.deleted_at IS NULL
		 ORDER BY ch.position NULLS FIRST, e.label`,
		[projectId]
	);
	return codes.rows;
}

export async function createAnnotation(
	projectId: string,
	userId: string,
	codeId: string,
	documentId: string,
	anchorType: 'text' | 'image_region',
	anchor: Record<string, unknown>,
	comment?: string
) {
	return transaction(async (client) => {
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'code.apply', $2, $3) RETURNING id`,
			[projectId, userId, JSON.stringify({ codeId, documentId, anchorType, anchor })]
		);

		const res = await client.query(
			`INSERT INTO annotations (project_id, code_id, document_id, constituted_by, anchor_type, anchor, comment)
			 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
			[projectId, codeId, documentId, eventRes.rows[0].id, anchorType, JSON.stringify(anchor), comment || null]
		);
		return res.rows[0];
	});
}

export async function getAnnotationsByDocument(projectId: string, documentId: string) {
	return (
		await query(
			`SELECT a.*, c.label as code_label, c.properties as code_properties
			 FROM annotations a
			 JOIN elements c ON c.id = a.code_id
			 WHERE a.project_id = $1 AND a.document_id = $2
			 ORDER BY a.created_at`,
			[projectId, documentId]
		)
	).rows;
}

export async function getAnnotationsByCode(projectId: string, codeId: string) {
	return (
		await query(
			`SELECT a.*, d.label as document_label
			 FROM annotations a
			 JOIN elements d ON d.id = a.document_id
			 WHERE a.project_id = $1 AND a.code_id = $2
			 ORDER BY a.created_at`,
			[projectId, codeId]
		)
	).rows;
}

export async function deleteAnnotation(annotationId: string, projectId: string) {
	await query('DELETE FROM annotations WHERE id = $1 AND project_id = $2', [annotationId, projectId]);
}
