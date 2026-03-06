import { query } from '../index.js';

export async function getEventsByProject(
	projectId: string,
	opts?: { limit?: number; afterSeq?: number; type?: string }
) {
	const conditions = ['project_id = $1'];
	const params: unknown[] = [projectId];
	let idx = 2;

	if (opts?.afterSeq) {
		conditions.push(`seq > $${idx++}`);
		params.push(opts.afterSeq);
	}
	if (opts?.type) {
		conditions.push(`type = $${idx++}`);
		params.push(opts.type);
	}

	const limit = opts?.limit || 100;
	params.push(limit);

	return (
		await query(
			`SELECT * FROM events
			 WHERE ${conditions.join(' AND ')}
			 ORDER BY seq ASC
			 LIMIT $${idx}`,
			params
		)
	).rows;
}
