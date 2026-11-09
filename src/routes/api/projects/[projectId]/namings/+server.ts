// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	designate,
	getOrCreateResearcherNaming,
	renameNaming,
	getNaming,
	scopeNamingIds,
	noteOnNaming,
	createParticipation,
	mergeNamings,
	markTechnicalError
} from '$lib/server/db/queries/namings.js';
import { relateElements, getNamingStack, getOrCreatePrimarySitMap } from '$lib/server/db/queries/maps.js';
import { getMemosForNaming } from '$lib/server/db/queries/memos.js';
import { discussCue } from '$lib/server/ai/runtime/index.js';
import { query } from '$lib/server/db/index.js';
import { setWithdrawnFlag, logWithdrawal } from '$lib/server/db/queries/situating.js';
import { quoted } from '$lib/shared/namingLabel.js';

async function isResearcherNaming(namingId: string): Promise<boolean> {
	const r = await query(`SELECT 1 FROM researcher_namings WHERE naming_id = $1`, [namingId]);
	return r.rows.length > 0;
}

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
		case 'create': {
			const { inscription, designation } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);

			const result = await query(
				`INSERT INTO namings (project_id, inscription, created_by)
				 VALUES ($1, $2, $3) RETURNING *`,
				[projectId, inscription.trim(), userId]
			);
			const naming = result.rows[0];

			// Initial act: inscription + designation in one stack entry
			await query(
				`INSERT INTO naming_acts (naming_id, by, inscription, designation)
				 VALUES ($1, $2, $3, $4)`,
				[naming.id, researcherNamingId, inscription.trim(), designation || 'cue']
			);

			// Ein ungeerdetes Naming gehört dem Projekt und damit auf dessen
			// Situations-Map — unplatziert, bis die Forscherin es setzt. BJ, S26:
			// „dann kann ich nciht willkürlich Namings aus der Map ausschließen,
			// sondern nur systematisch"; ungeerdete Namings „können zu jeder Form
			// von SitMap gehören, bzw. dort platziert werden". Derselbe Weg wie bei
			// Namings aus der Dokumentansicht (createOrphanNaming).
			const primaryMapId = await getOrCreatePrimarySitMap(projectId, userId);
			await query(
				`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
				 VALUES ($1, $2, 'entity', '{}')
				 ON CONFLICT (naming_id, perspective_id) DO NOTHING`,
				[naming.id, primaryMapId]
			);

			return json(naming, { status: 201 });
		}

		case 'getStack': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const stack = await getNamingStack(namingId, projectId);
			return json(stack);
		}

		case 'designate': {
			const { namingId, designation, memoText, linkedNamingIds } = body;
			if (!namingId || !designation) return json({ error: 'namingId and designation required' }, { status: 400 });
			// Scope the body UUID to this project (must not designate a foreign naming)
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const result = await designate(namingId, designation, researcherNamingId, {
				text: memoText,
				linkedNamingIds: await scopeNamingIds(linkedNamingIds, projectId)
			});
			return json(result);
		}

		case 'note': {
			// Memo ZU diesem Naming: ein Akt in seinem Stack (noteOnNaming), kein
			// eigenes Memo-Naming.
			const { namingId, memoText, linkedNamingIds } = body;
			if (!namingId || !memoText?.trim()) return json({ error: 'namingId and memoText required' }, { status: 400 });
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const act = await noteOnNaming(namingId, projectId, userId, {
				text: memoText,
				linkedNamingIds: await scopeNamingIds(linkedNamingIds, projectId)
			});
			return json(act);
		}

		case 'rename': {
			const { namingId, inscription, memoText, linkedNamingIds } = body;
			if (!namingId || !inscription?.trim()) return json({ error: 'namingId and inscription required' }, { status: 400 });
			// Scope the body UUID to this project (renameNaming's UPDATE is scoped,
			// but it still appends a naming_act unconditionally — guard first)
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const result = await renameNaming(namingId, projectId, userId, inscription.trim(), {
				text: memoText,
				linkedNamingIds: await scopeNamingIds(linkedNamingIds, projectId)
			});
			return json(result);
		}

		case 'withdraw': {
			// Zurückziehen ist kein Löschen: das Naming bleibt da, durchgestrichen,
			// und lässt sich wiederherstellen (withdrawn: false) — wie auf der Map,
			// hier für alle seine Erscheinungen.
			const { namingId, withdrawn } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const flag = withdrawn !== false;
			// Die Forscherin ist ein Naming, aber kein Gegenstand, den man
			// zurückzieht: Ihre Akte tragen ihren Namen.
			if (flag && (await isResearcherNaming(namingId))) {
				return json({ error: 'A researcher naming cannot be withdrawn' }, { status: 409 });
			}
			// Flag setzen (Zustand) und je betroffener Erscheinung den Akt
			// protokollieren (Geschichte, migrations/038).
			const before = await setWithdrawnFlag(namingId, flag, null);
			if (before.length > 0) {
				const by = await getOrCreateResearcherNaming(projectId, userId);
				await logWithdrawal({ namingId, by, withdrawn: flag, before });
			}
			return json({ ok: true, withdrawn: flag });
		}

		case 'technicalError': {
			// Als technischen Fehler markieren: dauerhaft ausblenden, nichts
			// löschen (markTechnicalError). Nicht für die Forscherin selbst und
			// nicht für Maps; eine Map hat ihre eigene Verwaltung.
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			if (await isResearcherNaming(namingId)) {
				return json({ error: 'A researcher naming cannot be hidden' }, { status: 409 });
			}
			const isMap = await query(
				`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $1
				   AND mode = 'perspective' AND properties ? 'mapType' LIMIT 1`,
				[namingId]
			);
			if (isMap.rows.length > 0) return json({ error: 'A map cannot be hidden here' }, { status: 409 });
			return json(await markTechnicalError(namingId, projectId, userId));
		}

		case 'relate': {
			const { sourceId, targetId, inscription, valence, symmetric } = body;
			if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });

			// Scope both endpoints to this project (body UUIDs must not cross projects)
			const endpoints = await query<{ id: string }>(
				`SELECT id FROM namings WHERE id = ANY($1::uuid[]) AND project_id = $2 AND deleted_at IS NULL`,
				[[sourceId, targetId], projectId]
			);
			const endpointIds = new Set(endpoints.rows.map((r) => r.id));
			if (!endpointIds.has(sourceId) || !endpointIds.has(targetId)) {
				return json({ error: 'source/target not found in project' }, { status: 404 });
			}

			// Find maps where BOTH source and target appear
			const sharedMaps = (await query(
				`SELECT DISTINCT a1.perspective_id
				 FROM appearances a1
				 JOIN appearances a2 ON a2.perspective_id = a1.perspective_id
				 JOIN appearances pa ON pa.naming_id = a1.perspective_id
				   AND pa.perspective_id = a1.perspective_id AND pa.mode = 'perspective'
				 WHERE a1.naming_id = $1 AND a2.naming_id = $2
				   AND a1.perspective_id != a1.naming_id
				   AND pa.properties ? 'mapType'`,
				[sourceId, targetId]
			)).rows;

			// Ein Paar hat eine Relation: besteht sie schon, sagt die Antwort das.
			const alreadyRelated = async (id: string) => {
				const [s, t] = await Promise.all([getNaming(sourceId, projectId), getNaming(targetId, projectId)]);
				return json(
					{
						error: `${quoted((s as any)?.inscription || '?')} and ${quoted((t as any)?.inscription || '?')} are already related. Open that relation to rename or re-designate it.`,
						alreadyRelated: true,
						id
					},
					{ status: 409 }
				);
			};

			if (sharedMaps.length > 0) {
				// Place on first shared map
				const relation = await relateElements(projectId, userId, sharedMaps[0].perspective_id, sourceId, targetId, {
					inscription, valence, symmetric
				});
				if (relation.alreadyRelated) return alreadyRelated(relation.id);
				// Also place on other shared maps
				for (let i = 1; i < sharedMaps.length; i++) {
					await query(
						`INSERT INTO appearances (naming_id, perspective_id, mode, directed_from, directed_to, valence, properties)
						 VALUES ($1, $2, 'relation', $3, $4, $5, '{}')
						 ON CONFLICT DO NOTHING`,
						[relation.id, sharedMaps[i].perspective_id,
						 symmetric ? null : sourceId, symmetric ? null : targetId,
						 valence || null]
					);
				}
				return json(relation, { status: 201 });
			}

			// No shared map — fall back to newest Sit Map, or create without map
			const sitMapId = await getNewestSitMapId(projectId);
			if (sitMapId) {
				const relation = await relateElements(projectId, userId, sitMapId, sourceId, targetId, {
					inscription, valence, symmetric
				});
				if (relation.alreadyRelated) return alreadyRelated(relation.id);
				return json(relation, { status: 201 });
			}

			// No map at all — create relation at ground-truth level (grounding
			// workspace). Derselbe Weg wie auf der Map: erster Akt mit Inschrift
			// und Valenz, Stufe nach derselben Regel, Hebung der Endpunkte.
			const { getOrCreateGroundingWorkspace } = await import('$lib/server/db/queries/annotations.js');
			const gwId = await getOrCreateGroundingWorkspace(projectId, userId);
			const relation = await relateElements(projectId, userId, gwId, sourceId, targetId, {
				inscription, valence, symmetric, skipEndpointAppearances: true
			});
			if (relation.alreadyRelated) return alreadyRelated(relation.id);
			return json(relation, { status: 201 });
		}

		case 'setValence': {
			const { namingId, valence: newValence } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			// Scope the body UUID to this project: only touch appearances whose
			// relation-naming belongs to this project.
			const v = typeof newValence === 'string' && newValence.trim() ? newValence.trim() : null;
			const changed = await query(
				`UPDATE appearances SET valence = $2, updated_at = now()
				 WHERE naming_id = $1 AND mode = 'relation' AND valence IS DISTINCT FROM $2
				   AND EXISTS (SELECT 1 FROM namings n WHERE n.id = $1 AND n.project_id = $3)`,
				[namingId, v, projectId]
			);
			// Die Valenz ist eine Dimension des Stacks (migrations/009): ihre
			// Änderung ist ein Akt. Leere Zeichenkette = Valenz entfernt (NULL
			// hieße dort „unverändert").
			if ((changed.rowCount ?? 0) > 0) {
				const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
				await query(
					`INSERT INTO naming_acts (naming_id, by, valence) VALUES ($1, $2, $3)`,
					[namingId, researcherNamingId, v ?? '']
				);
			}
			return json({ ok: true });
		}

		// (The old globally-destructive `switchToEntity` and `reifyAsRelation`
		// actions were removed: mode is a per-appearance collapse, not a
		// property of the naming, so flipping all appearances at once breaks
		// the collapse model. The map endpoint's `switchAppearanceMode`
		// action replaces them on a per-map basis.)

		case 'merge': {
			const { survivorId, mergedId } = body;
			if (!survivorId || !mergedId) return json({ error: 'survivorId and mergedId required' }, { status: 400 });
			if (survivorId === mergedId) return json({ error: 'Cannot merge a naming with itself' }, { status: 400 });
			if ((await isResearcherNaming(survivorId)) || (await isResearcherNaming(mergedId))) {
				return json({ error: 'A researcher naming cannot be merged' }, { status: 409 });
			}
			try {
				// Der Merge steht als Akt im Stack des überlebenden Namings.
				const result = await mergeNamings(projectId, userId, survivorId, mergedId);
				return json({
					survivorId: result.survivorId,
					mergedId: result.mergedId,
					mergedInscription: result.mergedInscription,
					survivorInscription: result.survivorInscription
				});
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 400 });
			}
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
			// Scope the body UUID to this project (must not discuss a foreign naming)
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });

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
