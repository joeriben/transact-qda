import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	designate,
	getOrCreateResearcherNaming,
	renameNaming,
	softDelete,
	getNaming
} from '$lib/server/db/queries/namings.js';
import { relateElements, getNamingStack } from '$lib/server/db/queries/maps.js';
import { createMemo, getMemosForNaming } from '$lib/server/db/queries/memos.js';
import { discussCue } from '$lib/server/ai/agent.js';
import { query } from '$lib/server/db/index.js';

// Find the newest active Sit Map for the project
async function getNewestSitMapId(projectId: string): Promise<string | null> {
	const result = await query(
		`SELECT n.id FROM namings n
		 JOIN appearances a ON a.naming_id = n.id AND a.perspective_id = n.id
		 WHERE n.project_id = $1
		   AND n.deleted_at IS NULL
		   AND a.mode = 'perspective'
		   AND a.properties->>'mapType' = 'situational'
		 ORDER BY n.seq DESC LIMIT 1`,
		[projectId]
	);
	return result.rows[0]?.id || null;
}

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { action } = body;
	const { projectId } = params;
	const userId = locals.user!.id;

	switch (action) {
		case 'getStack': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const stack = await getNamingStack(namingId);
			return json(stack);
		}

		case 'designate': {
			const { namingId, designation, memoText, linkedNamingIds } = body;
			if (!namingId || !designation) return json({ error: 'namingId and designation required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const result = await designate(namingId, designation, researcherNamingId);

			if (memoText?.trim() || (linkedNamingIds && linkedNamingIds.length > 0)) {
				const links = [namingId, ...(linkedNamingIds || [])];
				await createMemo(projectId, userId, `Designation → ${designation}`, memoText?.trim() || '', links);
			}

			return json(result);
		}

		case 'rename': {
			const { namingId, inscription, memoText, linkedNamingIds } = body;
			if (!namingId || !inscription?.trim()) return json({ error: 'namingId and inscription required' }, { status: 400 });
			const result = await renameNaming(namingId, projectId, userId, inscription.trim());

			if (memoText?.trim() || (linkedNamingIds && linkedNamingIds.length > 0)) {
				const links = [namingId, ...(linkedNamingIds || [])];
				await createMemo(projectId, userId, `Rename → ${inscription.trim()}`, memoText?.trim() || '', links);
			}

			return json(result);
		}

		case 'withdraw': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			await softDelete(namingId, projectId);
			return json({ ok: true });
		}

		case 'relate': {
			const { sourceId, targetId, inscription, valence, symmetric, properties } = body;
			if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });

			// Place new relation on the newest Sit Map
			const sitMapId = await getNewestSitMapId(projectId);
			if (!sitMapId) return json({ error: 'No situational map found' }, { status: 400 });

			const relation = await relateElements(projectId, userId, sitMapId, sourceId, targetId, {
				inscription, valence, symmetric, properties
			});
			return json(relation, { status: 201 });
		}

		case 'getMemosForNaming': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const memos = await getMemosForNaming(namingId, projectId);
			return json({ memos });
		}

		case 'discussCue': {
			const { namingId, message } = body;
			if (!namingId || !message?.trim()) return json({ error: 'namingId and message required' }, { status: 400 });

			// Find a map this naming appears on (for AI context)
			const mapResult = await query(
				`SELECT a.perspective_id FROM appearances a
				 JOIN namings m ON m.id = a.perspective_id AND m.deleted_at IS NULL
				 JOIN appearances ma ON ma.naming_id = m.id AND ma.perspective_id = m.id AND ma.mode = 'perspective'
				 WHERE a.naming_id = $1 AND a.perspective_id != $1
				   AND ma.properties ? 'mapType'
				 LIMIT 1`,
				[namingId]
			);
			const mapId = mapResult.rows[0]?.perspective_id;
			if (!mapId) return json({ error: 'Naming has no map context for AI discussion' }, { status: 400 });

			try {
				const result = await discussCue(projectId, mapId, namingId, message.trim(), userId);
				return json(result);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 500 });
			}
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
