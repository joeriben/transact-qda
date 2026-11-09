// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	getMap,
	getMapStructure,
	addElementToMap,
	placeExistingOnMap,
	findSameNamedNaming,
	placeMultipleOnMap,
	searchNamingsForPlacement,
	getOutsideParticipations,
	getDocumentNamingsForPlacement,
	relateElements,
	createProjectPhase,
	assignToPhase,
	removeFromPhase,
	getPhaseMembershipHistory,
	setCollapse,
	getNamingStack
} from '$lib/server/db/queries/maps.js';
import {
	designate,
	getOrCreateResearcherNaming,
	renameNaming,
	getInscriptionHistory,
	getDesignationHistory,
	getNaming,
	scopeNamingIds,
	noteLiftsCue,
	noteOnNaming
} from '$lib/server/db/queries/namings.js';
import { createMemo, getMemosForNaming, updateMemoStatus, promoteMemoToNaming } from '$lib/server/db/queries/memos.js';
import { getDocNetsByProject, getDocNetGroundedNamings } from '$lib/server/db/queries/docnets.js';
import { runMapAgent, setAiEnabled, discussCue, discussMemo } from '$lib/server/ai/runtime/index.js';
import { saveTopologyBuffer, saveTopologySnapshot, restoreTopologySnapshot, listTopologySnapshots } from '$lib/server/db/queries/topology.js';
import { getStoredPosition, logSituatingAct, getSituatingActs, setWithdrawnFlag, logWithdrawal } from '$lib/server/db/queries/situating.js';
import { computeSimilarityLayout } from '$lib/server/map/similarity-layout.js';
import { phaseInProject, bodyNamingInProject } from '$lib/server/auth/authz.js';
import { SW_ROLE_DEFAULTS } from '$lib/shared/constants.js';
import { quoted } from '$lib/shared/namingLabel.js';

export const GET: RequestHandler = async ({ params }) => {
	const map = await getMap(params.mapId, params.projectId);
	if (!map) return json({ error: 'Not found' }, { status: 404 });

	const structure = await getMapStructure(params.mapId, params.projectId);

	return json({ map, ...structure });
};

// POST handles all map mutations via an "action" field
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { action } = body;
	const { projectId, mapId } = params;
	const userId = locals.user!.id;

	// Scope the map UUID (from the URL) to this project: membership only proves
	// the caller belongs to projectId, not that mapId lives in it. A map is a
	// naming, so this guards every mapId-keyed action (withdrawRelation,
	// setCollapse, updatePosition, …) against cross-project targeting.
	if (!(await getMap(mapId, projectId))) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	// Read-only maps: reject all mutations except read-only queries
	const readOnlyActions = ['getStack', 'getHistory', 'getOutsideParticipations', 'getMemosForNaming',
		'searchForPlacement', 'listDocumentsForImport', 'getDocumentNamings', 'listTopologySnapshots',
		'getPhaseMembershipHistory', 'similarityLayout'];
	if (!readOnlyActions.includes(action)) {
		const map = await getMap(mapId, projectId);
		if (map?.properties?.readOnly) {
			return json({ error: 'This map is read-only (template). Copy the project to make changes.' }, { status: 403 });
		}
	}

	// Wer ein Naming gleich mit Koordinaten auf die Map setzt, überschreitet die
	// Schwelle in die Situation beim Anlegen — dieselbe Akt-Art wie das
	// Platzieren aus Unplaced (updatePosition), sonst fehlt sie im Stack.
	const logPlacedOnCreate = async (namingId: string, props: unknown) => {
		const p = (props ?? {}) as { x?: unknown; y?: unknown };
		const x = Number(p.x);
		const y = Number(p.y);
		if (p.x == null || p.y == null || !Number.isFinite(x) || !Number.isFinite(y)) return;
		const by = await getOrCreateResearcherNaming(projectId, userId);
		await logSituatingAct({ mapId, namingId, by, act: 'situate', x, y });
	};

	switch (action) {
		case 'similarityLayout': {
			// Similarity-driven positions: nearness = semantic nearness. Pure
			// computation (no write); the client saves the returned positions.
			const positions = await computeSimilarityLayout(mapId, projectId);
			return json({ positions });
		}

		case 'addElement': {
			const { inscription, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			// Gleicher Name im Projekt: das vorhandene Naming holen, kein zweites anlegen.
			const same = await findSameNamedNaming(projectId, mapId, inscription.trim());
			if (same?.on_map) {
				return json({ error: `"${same.inscription}" is already on this map.`, alreadyOnMap: true, id: same.id }, { status: 409 });
			}
			if (same) {
				const placed = await placeExistingOnMap(projectId, userId, mapId, same.id, 'entity', properties);
				if (!placed) return json({ error: `"${same.inscription}" is already on this map.`, alreadyOnMap: true, id: same.id }, { status: 409 });
				await logPlacedOnCreate(same.id, properties);
				return json({ ...placed, reused: true }, { status: 201 });
			}
			const element = await addElementToMap(projectId, userId, mapId, inscription.trim(), properties);
			await logPlacedOnCreate(element.id, properties);
			// Fire AI agent asynchronously — never blocks the response
			runMapAgent(projectId, mapId, { action: 'addElement', details: { inscription: inscription.trim() } }).catch(() => {});
			return json(element, { status: 201 });
		}

		case 'addFormation': {
			const { inscription, swRole, memoText, properties } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			if (!swRole) return json({ error: 'swRole required' }, { status: 400 });
			const defaults = SW_ROLE_DEFAULTS[swRole as keyof typeof SW_ROLE_DEFAULTS] || SW_ROLE_DEFAULTS['social-world'];
			// Die Rolle (Arena, Soziale Welt, Organisation, Diskurs) ist die Art,
			// wie das Naming unter DIESER Perspektive erscheint — sie gehört an
			// seine Erscheinung auf der SW/A-Map, nicht in ein Memo („Ein Naming
			// hat keine Art, bevor es unter einer Perspektive erscheint").
			// Früher stand sie in einem automatisch angelegten, leeren
			// „Formation: <role>"-Memo; getMapStructure liest das für alte
			// Formationen weiter.
			const formationProps = { ...defaults, ...properties, swRole };
			// Gleicher Name im Projekt: das vorhandene Naming erscheint hier als
			// Formation (seine Rolle unter dieser Perspektive), kein zweites Naming.
			const same = await findSameNamedNaming(projectId, mapId, inscription.trim());
			if (same?.on_map) {
				return json({ error: `"${same.inscription}" is already on this map.`, alreadyOnMap: true, id: same.id }, { status: 409 });
			}
			let element: { id: string; inscription: string };
			let reused = false;
			if (same) {
				const placed = await placeExistingOnMap(projectId, userId, mapId, same.id, 'entity', formationProps);
				if (!placed) return json({ error: `"${same.inscription}" is already on this map.`, alreadyOnMap: true, id: same.id }, { status: 409 });
				element = placed;
				reused = true;
			} else {
				element = await addElementToMap(projectId, userId, mapId, inscription.trim(), formationProps);
			}
			await logPlacedOnCreate(element.id, formationProps);
			// Ein Memo entsteht nur, wenn die Forscherin eines schreibt — dann als
			// Akt im Stack dieses Namings.
			if (memoText?.trim()) {
				await noteOnNaming(element.id, projectId, userId, { text: memoText.trim(), linkedNamingIds: [] });
			}
			runMapAgent(projectId, mapId, { action: 'addFormation', details: { inscription: inscription.trim(), swRole } }).catch(() => {});
			return json(reused ? { ...element, reused: true } : element, { status: 201 });
		}

		case 'placeExisting': {
			const { namingId, mode, properties } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const placed = await placeExistingOnMap(projectId, userId, mapId, namingId, mode, properties);
			if (!placed) return json({ error: 'Naming not found or already on this map' }, { status: 409 });
			await logPlacedOnCreate(namingId, properties);
			return json(placed, { status: 201 });
		}

		case 'searchForPlacement': {
			const { query: searchQuery } = body;
			if (!searchQuery?.trim()) return json({ results: [] });
			const results = await searchNamingsForPlacement(projectId, mapId, searchQuery.trim());
			return json({ results });
		}

		case 'listDocumentsForImport': {
			const { query: dbQ } = await import('$lib/server/db/index.js');
			const docs = await dbQ(
				`SELECT n.id, n.inscription as label,
				   (SELECT count(DISTINCT ann.directed_from)
				    FROM appearances ann
				    JOIN namings nm ON nm.id = ann.directed_from AND nm.deleted_at IS NULL
				    WHERE ann.directed_to = n.id AND ann.valence = 'codes'
				      AND NOT EXISTS (
				        SELECT 1 FROM appearances a_map
				        WHERE a_map.naming_id = nm.id AND a_map.perspective_id = $2
				      )
				   )::int as importable_count
				 FROM namings n
				 JOIN document_content dc ON dc.naming_id = n.id
				 WHERE n.project_id = $1 AND n.deleted_at IS NULL
				 ORDER BY n.inscription`,
				[projectId, mapId]
			);
			return json({ documents: docs.rows });
		}

		case 'importFromDocument': {
			const { documentId } = body;
			if (!documentId) return json({ error: 'documentId required' }, { status: 400 });
			const candidates = await getDocumentNamingsForPlacement(projectId, mapId, documentId);
			if (candidates.length === 0) return json({ placed: 0, message: 'No new namings to import' });
			const placed = await placeMultipleOnMap(projectId, userId, mapId, candidates.map((c: any) => c.id));
			return json({ placed, total: candidates.length });
		}

		case 'listDocNetsForImport': {
			const docnets = await getDocNetsByProject(projectId);
			// For each docnet, count how many grounded namings are NOT yet on this map
			const enriched = await Promise.all(docnets.map(async (dn: any) => {
				const grounded = await getDocNetGroundedNamings(dn.id, projectId);
				const { query: dbQ } = await import('$lib/server/db/index.js');
				let importableCount = 0;
				for (const g of grounded) {
					const onMap = await dbQ(
						`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 LIMIT 1`,
						[g.id, mapId]
					);
					if (onMap.rows.length === 0) importableCount++;
				}
				return { id: dn.id, label: dn.label, document_count: dn.document_count, importable_count: importableCount };
			}));
			return json({ docnets: enriched });
		}

		case 'importFromDocNet': {
			const { docnetId } = body;
			if (!docnetId) return json({ error: 'docnetId required' }, { status: 400 });
			const grounded = await getDocNetGroundedNamings(docnetId, projectId);
			// Filter to only those not already on this map
			const { query: dbQ } = await import('$lib/server/db/index.js');
			const toPlace: string[] = [];
			for (const g of grounded) {
				const onMap = await dbQ(
					`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 LIMIT 1`,
					[g.id, mapId]
				);
				if (onMap.rows.length === 0) toPlace.push(g.id);
			}
			if (toPlace.length === 0) return json({ placed: 0, message: 'No new namings to import' });
			const placed = await placeMultipleOnMap(projectId, userId, mapId, toPlace);
			return json({ placed, total: toPlace.length });
		}

		case 'getDocumentNamings': {
			const { documentId } = body;
			if (!documentId) return json({ error: 'documentId required' }, { status: 400 });
			const namings = await getDocumentNamingsForPlacement(projectId, mapId, documentId);
			return json({ namings });
		}

		case 'getOutsideParticipations': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const outside = await getOutsideParticipations(mapId, projectId, namingId);
			return json({ participations: outside });
		}

		case 'relate': {
			const { sourceId, targetId, inscription, valence, symmetric, properties } = body;
			if (!sourceId || !targetId) return json({ error: 'sourceId and targetId required' }, { status: 400 });
			// Beide Endpunkte gehören zu diesem Projekt: relateElements legt
			// fehlende Erscheinungen auf dieser Map an, sonst ließe sich
			// Projektfremdes auf die eigene Map holen.
			if (!(await bodyNamingInProject(sourceId, projectId)) || !(await bodyNamingInProject(targetId, projectId))) {
				return json({ error: 'Not found' }, { status: 404 });
			}
			const relation = await relateElements(projectId, userId, mapId, sourceId, targetId, {
				inscription, valence, symmetric, properties
			});
			// Resolve inscriptions for AI context
			const [srcNaming, tgtNaming] = await Promise.all([getNaming(sourceId, projectId), getNaming(targetId, projectId)]);
			if (relation.alreadyRelated) {
				const s = quoted((srcNaming as any)?.inscription || '?');
				const t = quoted((tgtNaming as any)?.inscription || '?');
				return json(
					{ error: `${s} and ${t} are already related. Open that relation to rename or re-designate it.`, alreadyRelated: true, id: relation.id },
					{ status: 409 }
				);
			}
			runMapAgent(projectId, mapId, {
				action: 'relate',
				details: {
					sourceInscription: (srcNaming as any)?.inscription || sourceId,
					targetInscription: (tgtNaming as any)?.inscription || targetId,
					inscription, valence
				}
			}).catch(() => {});
			return json(relation, { status: 201 });
		}

		case 'createPhase': {
			const { inscription } = body;
			if (!inscription?.trim()) return json({ error: 'inscription required' }, { status: 400 });
			const phase = await createProjectPhase(projectId, userId, inscription.trim());
			return json(phase, { status: 201 });
		}

		case 'assignToPhase': {
			const { phaseId, namingId, mode, properties } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			if (!(await phaseInProject(phaseId, projectId)) || !(await bodyNamingInProject(namingId, projectId))) {
				return json({ error: 'Not found' }, { status: 404 });
			}
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			const appearance = await assignToPhase(phaseId, namingId, mode, properties, researcherNamingId);
			return json(appearance);
		}

		case 'removeFromPhase': {
			const { phaseId, namingId } = body;
			if (!phaseId || !namingId) return json({ error: 'phaseId and namingId required' }, { status: 400 });
			if (!(await phaseInProject(phaseId, projectId)) || !(await bodyNamingInProject(namingId, projectId))) {
				return json({ error: 'Not found' }, { status: 404 });
			}
			const researcherNamingId = await getOrCreateResearcherNaming(projectId, userId);
			await removeFromPhase(phaseId, namingId, researcherNamingId);
			return json({ ok: true });
		}

		case 'getPhaseMembershipHistory': {
			const { phaseId } = body;
			if (!phaseId) return json({ error: 'phaseId required' }, { status: 400 });
			if (!(await phaseInProject(phaseId, projectId))) return json({ error: 'Not found' }, { status: 404 });
			const history = await getPhaseMembershipHistory(phaseId);
			return json({ memberships: history });
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
			// Memo ZU diesem Naming: ein Akt in seinem Stack (noteOnNaming).
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
			// Scope the body UUID to this project (renameNaming still appends a
			// naming_act unconditionally even when its UPDATE matches nothing)
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const result = await renameNaming(namingId, projectId, userId, inscription.trim(), {
				text: memoText,
				linkedNamingIds: await scopeNamingIds(linkedNamingIds, projectId)
			});
			return json(result);
		}

		case 'getHistory': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			// Scope the body UUID to this project (must not read a foreign naming's history)
			if (!(await getNaming(namingId, projectId))) return json({ error: 'naming not found in project' }, { status: 404 });
			const [inscriptions, designations] = await Promise.all([
				getInscriptionHistory(namingId),
				getDesignationHistory(namingId)
			]);
			return json({ inscriptions, designations });
		}

		case 'getStack': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			// Situating acts are a separate, non-designation history (see
			// migrations/034); they ride along here so the researcher sees one
			// coherent account of a naming without a second round trip.
			const [stack, situating] = await Promise.all([
				getNamingStack(namingId, projectId),
				getSituatingActs(namingId, projectId)
			]);
			return json({ ...stack, situating });
		}

		case 'setCollapse': {
			const { namingId, collapseAt } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const result = await setCollapse(namingId, mapId, collapseAt ?? null);
			return json(result || { ok: true });
		}

		case 'withdraw': {
			// Zurückziehen und Wiederherstellen auf dieser Map: das Flag ist der
			// Zustand, der Akt steht im Situierungs-Protokoll (migrations/038).
			const { namingId, withdrawn } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const flag = withdrawn !== false;
			const before = await setWithdrawnFlag(namingId, flag, mapId);
			if (before.length > 0) {
				const by = await getOrCreateResearcherNaming(projectId, userId);
				await logWithdrawal({ namingId, by, withdrawn: flag, before });
			}
			return json({ ok: true, withdrawn: flag });
		}

		case 'toggleAi': {
			const { enabled } = body;
			await setAiEnabled(mapId, enabled !== false);
			return json({ ok: true, aiEnabled: enabled !== false });
		}

		// Cowork auf Abruf läuft über /api/projects/[projectId]/cowork (mit
		// Rückmeldung, wie der Lauf ausging); der frühere Aufruf hier gab nur
		// { ok: true } zurück.

		case 'discussCue': {
			const { namingId, message } = body;
			if (!namingId || !message?.trim()) return json({ error: 'namingId and message required' }, { status: 400 });
			try {
				const result = await discussCue(projectId, mapId, namingId, message.trim(), userId);
				return json(result);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 500 });
			}
		}

		case 'discussMemo': {
			const { memoId, message } = body;
			if (!memoId || !message?.trim()) return json({ error: 'memoId and message required' }, { status: 400 });
			try {
				const result = await discussMemo(projectId, mapId, memoId, message.trim(), userId);
				return json(result);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return json({ error: msg }, { status: 500 });
			}
		}

		case 'getMemosForNaming': {
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			const memos = await getMemosForNaming(namingId, projectId);
			return json({ memos });
		}

		case 'syncSpatialRelations': {
			// Aus Containments und Überschneidungen abgeleitete Relationen (BJ,
			// Sitzung 15: „Verschiebe ich ein ELement, geht es neue Beziehungen
			// ein, die diesen Relation-Stack automatisch updaten müssen").
			// Entsteht ein Verhältnis wieder, das schon einmal abgeleitet und
			// zurückgezogen wurde, kehrt DIESELBE Relation zurück (Restore) —
			// kein neues Naming bei jedem Hin- und Herschieben.
			const { add, remove } = body;
			const results = { added: 0, removed: 0, restored: 0 };
			const { query: dbQuery } = await import('$lib/server/db/index.js');
			const by = await getOrCreateResearcherNaming(projectId, userId);

			// Veraltete abgeleitete Relationen zurückziehen (nicht löschen)
			if (remove && Array.isArray(remove)) {
				for (const relId of remove) {
					const isRelation = await dbQuery(
						`SELECT 1 FROM appearances WHERE naming_id = $1 AND perspective_id = $2 AND mode = 'relation'`,
						[relId, mapId]
					);
					if (isRelation.rows.length === 0) continue;
					const before = await setWithdrawnFlag(relId, true, mapId);
					await logWithdrawal({ namingId: relId, by, withdrawn: true, before });
					results.removed++;
				}
			}

			if (add && Array.isArray(add)) {
				// Nur Namings dieses Projekts (relateElements legt Erscheinungen an).
				const inProject = new Set(
					await scopeNamingIds(add.flatMap((r: any) => [r?.sourceId, r?.targetId]), projectId)
				);
				for (const rel of add) {
					if (!inProject.has(rel?.sourceId) || !inProject.has(rel?.targetId)) continue;
					const symmetric = !!rel.symmetric;
					const prior = await dbQuery<{ naming_id: string }>(
						`SELECT a.naming_id
						 FROM appearances a
						 JOIN participations p ON p.id = a.naming_id
						 JOIN namings n ON n.id = a.naming_id AND n.deleted_at IS NULL AND n.project_id = $6
						 WHERE a.perspective_id = $1 AND a.mode = 'relation'
						   AND (a.properties->>'spatiallyDerived')::boolean IS TRUE
						   AND a.valence IS NOT DISTINCT FROM $4
						   AND ((p.naming_id = $2 AND p.participant_id = $3)
						        OR ($5 AND p.naming_id = $3 AND p.participant_id = $2))
						 ORDER BY COALESCE((a.properties->>'withdrawn')::boolean, false) ASC, a.updated_at DESC
						 LIMIT 1`,
						[mapId, rel.sourceId, rel.targetId, rel.valence ?? null, symmetric, projectId]
					);
					const existingId = prior.rows[0]?.naming_id;
					if (existingId) {
						const before = await setWithdrawnFlag(existingId, false, mapId);
						if (before.some((b) => b.wasWithdrawn)) {
							await logWithdrawal({ namingId: existingId, by, withdrawn: false, before });
							results.restored++;
						}
						continue;
					}
					// Haben die Forschenden das Paar schon selbst verbunden, leitet
					// die Lage keine zweite Relation ab (ein Paar, eine Relation).
					const derived = await relateElements(projectId, userId, mapId, rel.sourceId, rel.targetId, {
						valence: rel.valence,
						symmetric,
						properties: { spatiallyDerived: true },
						skipDesignationAdvance: true,
					});
					if (!derived.alreadyRelated) results.added++;
				}
			}

			// No AI agent trigger — spatial sync is high-frequency
			return json(results);
		}

		case 'switchAppearanceMode': {
			// Per-map collapse flip: change mode only for THIS map's appearance of
			// the naming. Does not touch any other appearance. For entity → relation
			// the caller also supplies sourceId, targetId (and optionally valence).
			// For relation → entity we leave directed_from/to in place so
			// re-flipping later keeps the endpoints. Der Wechsel ist ein Akt im
			// Stack (naming_acts.mode, migrations/009: „mode/valence changes …
			// first-class naming acts").
			const { namingId, mode, sourceId, targetId, valence, memoText, linkedNamingIds } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			if (mode !== 'entity' && mode !== 'relation') {
				return json({ error: "mode must be 'entity' or 'relation'" }, { status: 400 });
			}
			if (!(await bodyNamingInProject(namingId, projectId))) return json({ error: 'Not found' }, { status: 404 });
			const { query: dbQuery } = await import('$lib/server/db/index.js');
			const current = (
				await dbQuery<{ mode: string }>(
					`SELECT mode FROM appearances WHERE naming_id = $1 AND perspective_id = $2`,
					[namingId, mapId]
				)
			).rows[0];
			if (!current) return json({ error: 'This naming is not on this map.' }, { status: 404 });
			if (current.mode === mode) return json({ ok: true, unchanged: true });
			// Erst beim ersten Verbinden dieser beiden: dann heben sich ihre Cues
			// wie beim Ziehen einer Relation (relateElements). Ein Zurückwechseln
			// in eine schon bestehende Relation verbindet nichts neu.
			let newlyRelated = false;
			if (mode === 'relation') {
				if (!sourceId || !targetId) {
					return json({ error: 'sourceId and targetId required for relation' }, { status: 400 });
				}
				if (sourceId === targetId || sourceId === namingId || targetId === namingId) {
					return json({ error: 'Pick two other namings as the ends of this relation.' }, { status: 400 });
				}
				if (!(await bodyNamingInProject(sourceId, projectId)) || !(await bodyNamingInProject(targetId, projectId))) {
					return json({ error: 'Not found' }, { status: 404 });
				}
				// Die Endpunkte gehören zum Naming, nicht zur Map: Ist es anderswo
				// schon Relation, bleiben seine Endpunkte (kein Überschreiben).
				const own = (
					await dbQuery<{ naming_id: string; participant_id: string }>(
						`SELECT naming_id, participant_id FROM participations WHERE id = $1`,
						[namingId]
					)
				).rows[0];
				if (own) {
					const same =
						(own.naming_id === sourceId && own.participant_id === targetId) ||
						(own.naming_id === targetId && own.participant_id === sourceId);
					if (!same) {
						return json(
							{ error: 'This naming already relates two other namings; it can appear here only as that relation.' },
							{ status: 409 }
						);
					}
				} else {
					const taken = (
						await dbQuery<{ id: string }>(
							`SELECT id FROM participations WHERE naming_id = $1 AND participant_id = $2`,
							[sourceId, targetId]
						)
					).rows[0];
					if (taken) {
						return json(
							{ error: 'These two namings are already related by another relation.', alreadyRelated: true, id: taken.id },
							{ status: 409 }
						);
					}
					await dbQuery(
						`INSERT INTO participations (id, naming_id, participant_id) VALUES ($1, $2, $3)`,
						[namingId, sourceId, targetId]
					);
					newlyRelated = true;
				}
				// Strukturelle Integrität wie bei relateElements: beide Enden erscheinen hier.
				for (const endpointId of [sourceId, targetId]) {
					await dbQuery(
						`INSERT INTO appearances (naming_id, perspective_id, mode, properties)
						 VALUES ($1, $2, 'entity', '{}') ON CONFLICT (naming_id, perspective_id) DO NOTHING`,
						[endpointId, mapId]
					);
				}
				await dbQuery(
					`UPDATE appearances
					 SET mode = 'relation',
					     directed_from = $3,
					     directed_to = $4,
					     valence = COALESCE($5, valence),
					     updated_at = now()
					 WHERE naming_id = $1 AND perspective_id = $2`,
					[namingId, mapId, sourceId, targetId, valence || null]
				);
			} else {
				await dbQuery(
					`UPDATE appearances SET mode = 'entity', updated_at = now()
					 WHERE naming_id = $1 AND perspective_id = $2`,
					[namingId, mapId]
				);
			}
			const by = await getOrCreateResearcherNaming(projectId, userId);
			// Wie bei Rename und Designation kann der Akt eine Notiz tragen; eine
			// Notiz hebt einen Cue auf characterization (S08: „ein reflected cue
			// ist mindestens eine characterization").
			const note = typeof memoText === 'string' && memoText.trim() ? memoText.trim() : null;
			const links = note ? await scopeNamingIds(linkedNamingIds, projectId) : [];
			const lift = note ? await noteLiftsCue(namingId) : false;
			await dbQuery(
				`INSERT INTO naming_acts (naming_id, by, mode, valence, memo_text, linked_naming_ids, designation)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				[namingId, by, mode, mode === 'relation' ? valence?.trim() || null : null,
				 note, links.length > 0 ? links : null, lift ? 'characterization' : null]
			);
			// Wie beim Ziehen einer Relation (relateElements): verbundene Cues steigen
			// auf characterization, der Akt nennt die Relation, die sie hebt
			// (Testlauf 09.11.: „Anders als Relate hebt es die Enden nicht").
			const liftedEnds: string[] = [];
			if (newlyRelated) {
				for (const endId of [sourceId, targetId]) {
					const cur = (
						await dbQuery<{ designation: string; inscription: string }>(
							`SELECT na.designation, n.inscription FROM naming_acts na JOIN namings n ON n.id = na.naming_id
							  WHERE na.naming_id = $1 AND na.designation IS NOT NULL ORDER BY na.seq DESC LIMIT 1`,
							[endId]
						)
					).rows[0];
					if (cur?.designation === 'cue') {
						await dbQuery(
							`INSERT INTO naming_acts (naming_id, designation, by, linked_naming_ids)
							 VALUES ($1, 'characterization', $2, $3)`,
							[endId, by, [namingId]]
						);
						liftedEnds.push(cur.inscription);
					}
				}
			}
			return json({ ok: true, lifted: lift, liftedEnds });
		}

		case 'updatePosition': {
			const { namingId, x, y } = body;
			if (!namingId || x == null || y == null) return json({ error: 'namingId, x, y required' }, { status: 400 });
			// Crossing the threshold into the situation is the act; nudging an
			// already-situated card is not. Read the prior state first so only
			// the transition is logged.
			const wasPlaced = await getStoredPosition(namingId, mapId);
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify({ x, y }), namingId, mapId]
				)
			);
			if (!wasPlaced) {
				const by = await getOrCreateResearcherNaming(projectId, userId);
				await logSituatingAct({ mapId, namingId, by, act: 'situate', x, y });
			}
			return json({ ok: true });
		}

		case 'updateProperties': {
			const { namingId, properties } = body;
			if (!namingId || !properties || typeof properties !== 'object') return json({ error: 'namingId and properties object required' }, { status: 400 });
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify(properties), namingId, mapId]
				)
			);
			return json({ ok: true });
		}

		case 'updatePositions': {
			const { positions } = body;
			if (!positions || !Array.isArray(positions)) return json({ error: 'positions array required' }, { status: 400 });
			const { query: dbQuery } = await import('$lib/server/db/index.js');
			for (const pos of positions) {
				await dbQuery(
					`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
					 WHERE naming_id = $2 AND perspective_id = $3`,
					[JSON.stringify({ x: pos.x, y: pos.y }), pos.namingId, mapId]
				);
			}
			return json({ ok: true });
		}

		case 'clearPosition': {
			// Un-situate: strip the stored x/y so the naming returns to the
			// Unplaced panel (Halde). Same scoping as updatePosition. Revising a
			// placement, like placing, acts on a derivative projection — not a
			// designation, so no naming_act.
			const { namingId } = body;
			if (!namingId) return json({ error: 'namingId required' }, { status: 400 });
			// Keep the coordinates it had: that is what makes the take-back
			// reversible. Nothing stored means nothing to take back — no act.
			const wasPlaced = await getStoredPosition(namingId, mapId);
			await import('$lib/server/db/index.js').then(({ query }) =>
				query(
					`UPDATE appearances SET properties = properties - 'x' - 'y', updated_at = now()
					 WHERE naming_id = $1 AND perspective_id = $2`,
					[namingId, mapId]
				)
			);
			if (wasPlaced) {
				const by = await getOrCreateResearcherNaming(projectId, userId);
				await logSituatingAct({ mapId, namingId, by, act: 'unsituate', x: wasPlaced.x, y: wasPlaced.y });
			}
			return json({ ok: true });
		}

		case 'saveTopologyBuffer': {
			const { positions: posData } = body;
			if (!posData) return json({ error: 'positions required' }, { status: 400 });
			await saveTopologyBuffer(mapId, posData);
			return json({ ok: true });
		}

		case 'saveTopologySnapshot': {
			const { label: snapLabel, positions: snapPositions } = body;
			const snapshot = await saveTopologySnapshot(mapId, snapLabel, snapPositions);
			return json(snapshot, { status: 201 });
		}

		case 'restoreTopologySnapshot': {
			const { seq } = body;
			if (seq == null) return json({ error: 'seq required' }, { status: 400 });
			const restored = await restoreTopologySnapshot(mapId, seq);
			if (!restored) return json({ error: 'Snapshot not found' }, { status: 404 });
			return json({ ok: true, positions: restored.positions });
		}

		case 'listTopologySnapshots': {
			const snapshots = await listTopologySnapshots(mapId);
			return json({ snapshots });
		}

		case 'updateMemoStatus': {
			const { memoId, status } = body;
			if (!memoId || !status) return json({ error: 'memoId and status required' }, { status: 400 });
			const validStatuses = ['active', 'presented', 'discussed', 'acknowledged', 'promoted', 'dismissed'];
			if (!validStatuses.includes(status)) return json({ error: 'Invalid status' }, { status: 400 });
			if (!(await bodyNamingInProject(memoId, projectId))) return json({ error: 'Not found' }, { status: 404 });
			// „promoted" heißt überall: das Memo wird zu einem Naming (wie promoteMemo).
			if (status === 'promoted') {
				try {
					const naming = await promoteMemoToNaming(projectId, userId, memoId, mapId);
					return json({ ok: true, status, namingId: naming.id });
				} catch (error) {
					return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
				}
			}
			await updateMemoStatus(memoId, status);
			return json({ ok: true, status });
		}

		case 'promoteMemo': {
			const { memoId } = body;
			if (!memoId) return json({ error: 'memoId required' }, { status: 400 });
			try {
				const naming = await promoteMemoToNaming(projectId, userId, memoId, mapId);
				return json(naming, { status: 201 });
			} catch (error) {
				return json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
			}
		}

		default:
			return json({ error: `Unknown action: ${action}` }, { status: 400 });
	}
};
