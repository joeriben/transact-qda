import { query, queryOne, transaction } from '../index.js';

export async function createMemo(
	projectId: string,
	userId: string,
	label: string,
	content: string = '',
	linkedElementIds: string[] = []
) {
	return transaction(async (client) => {
		const eventRes = await client.query(
			`INSERT INTO events (project_id, type, created_by, data)
			 VALUES ($1, 'memo.create', $2, $3) RETURNING id`,
			[projectId, userId, JSON.stringify({ label })]
		);

		const elemRes = await client.query(
			`INSERT INTO elements (project_id, kind, label, constituted_by)
			 VALUES ($1, 'memo', $2, $3) RETURNING *`,
			[projectId, label, eventRes.rows[0].id]
		);
		const memoId = elemRes.rows[0].id;

		await client.query(
			`INSERT INTO memo_content (element_id, content, format) VALUES ($1, $2, 'html')`,
			[memoId, content]
		);

		for (const targetId of linkedElementIds) {
			await client.query(
				`INSERT INTO memo_links (memo_id, target_id, link_type) VALUES ($1, $2, 'reference')`,
				[memoId, targetId]
			);
		}

		return elemRes.rows[0];
	});
}

export async function getMemosByProject(projectId: string) {
	return (
		await query(
			`SELECT e.id, e.label, e.created_at, e.updated_at,
			        mc.content, mc.format,
			        (SELECT COUNT(*) FROM memo_links ml WHERE ml.memo_id = e.id) as link_count
			 FROM elements e
			 JOIN memo_content mc ON mc.element_id = e.id
			 WHERE e.project_id = $1 AND e.kind = 'memo' AND e.deleted_at IS NULL
			 ORDER BY e.updated_at DESC`,
			[projectId]
		)
	).rows;
}

export async function getMemo(memoId: string, projectId: string) {
	const memo = await queryOne(
		`SELECT e.id, e.label, e.created_at, e.updated_at,
		        mc.content, mc.format
		 FROM elements e
		 JOIN memo_content mc ON mc.element_id = e.id
		 WHERE e.id = $1 AND e.project_id = $2 AND e.kind = 'memo' AND e.deleted_at IS NULL`,
		[memoId, projectId]
	);
	if (!memo) return null;

	const links = await query(
		`SELECT ml.id, ml.target_id, ml.link_type, t.label as target_label, t.kind as target_kind
		 FROM memo_links ml
		 JOIN elements t ON t.id = ml.target_id
		 WHERE ml.memo_id = $1`,
		[memoId]
	);

	return { ...memo, links: links.rows };
}

export async function updateMemoContent(memoId: string, content: string) {
	await query(
		`UPDATE memo_content SET content = $1 WHERE element_id = $2`,
		[content, memoId]
	);
	await query(
		`UPDATE elements SET updated_at = now() WHERE id = $1`,
		[memoId]
	);
}

export async function addMemoLink(memoId: string, targetId: string, linkType: string = 'reference') {
	return queryOne(
		`INSERT INTO memo_links (memo_id, target_id, link_type)
		 VALUES ($1, $2, $3) RETURNING *`,
		[memoId, targetId, linkType]
	);
}

export async function removeMemoLink(linkId: string) {
	await query('DELETE FROM memo_links WHERE id = $1', [linkId]);
}
