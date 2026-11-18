// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Eine Schicht des Stacks aktivieren.
 *
 * Ein Naming IST sein Stack: „das ELement IST diese Schichtung seiner
 * Veränderungen, acuh wenn wir die letzte als Naming verwenden (Aufhebungen)"
 * (BJ, Session 03). „jedes Naming erhält eben einen INdex (default ist das
 * oberste), und diser INdex ist sein Collapse, der mit anderen collapses z.B.
 * von Relations-Namings spezifisch zusammenhängt" (ebd.). Maps sind
 * „dezentrale Mittel, die auf denselben Datenraum einwirken, aber zugleich ihre
 * Indizes/Stack-Positionen behalten" (Session 09).
 *
 * Zwei Wege, beide append-only und beide selbst ein Akt (03.07.2026, BJ zum
 * nicht historisierten Kollaps: „offensichtlich falsch implementiert"):
 *
 * - collapsePerspective: Eine Perspektive (Map, Phase) zeigt das Naming auf
 *   einer bestimmten Schicht; ohne Index folgt sie der obersten. Zustand an
 *   der Erscheinung (properties.collapseAt), Akt im Situierungs-Protokoll
 *   ('collapse' / 'release', migrations/040).
 * - activateLayer: Im Datenraum (Liste, Detailseite) wird eine frühere Schicht
 *   wieder die oberste — durch einen neuen Akt, der ihre Inschrift und
 *   Designation aufnimmt (naming_acts.activates_seq). Perspektiven mit eigenem
 *   Index behalten ihn.
 *
 * Die Schichten folgen der Zeit der Akte (naming_state_at, migrations/040).
 */

import { query, queryOne, transaction } from '../index.js';
import { getOrCreateResearcherNaming, AI_SYSTEM_USER_ID } from './namings.js';

export type LayerState = {
	layer_seq: string;
	layer_at: string;
	/** '' = ohne eigenen Namen (Relation). */
	inscription: string | null;
	designation: string;
	/** '' = Valenz entfernt; null = bis hierher keine erfasst. */
	valence: string | null;
	/** Wessen Akt die Schicht ist: das Naming selbst oder ein aufgenommenes. */
	owner: string;
};

/** Ein seq aus einem Request: nur eine ganze Zahl, sonst null. */
export function parseSeq(v: unknown): string | null {
	const t = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
	return /^[0-9]{1,18}$/.test(t) ? t : null;
}

/**
 * Zustand auf genau dieser Schicht: seq muss ein Akt dieses Namings sein oder
 * eines Namings, das in es aufgenommen wurde (naming_layer_owner).
 */
export async function getLayerState(namingId: string, seq: number | string): Promise<LayerState | null> {
	return queryOne<LayerState>(
		`SELECT s.layer_seq, s.layer_at, s.inscription, s.designation, s.valence, s.owner
		   FROM naming_state_at($1, $2::bigint) s
		  WHERE naming_layer_owner($1, $2::bigint) IS NOT NULL AND s.layer_seq = $2::bigint`,
		[namingId, String(seq)]
	);
}

/** Der Zustand der obersten Schicht (Zeitfolge der Akte). */
export async function getTopState(namingId: string): Promise<LayerState | null> {
	return queryOne<LayerState>(
		`SELECT s.layer_seq, s.layer_at, s.inscription, s.designation, s.valence, s.owner
		   FROM (SELECT na.seq FROM naming_acts na WHERE na.naming_id = $1
		          ORDER BY date_trunc('milliseconds', na.created_at) DESC, na.seq DESC LIMIT 1) top
		   CROSS JOIN LATERAL naming_state_at($1, top.seq) s`,
		[namingId]
	);
}

export class StackLayerError extends Error {
	constructor(
		message: string,
		public status: number
	) {
		super(message);
	}
}

/**
 * Eine Perspektive (Map oder Phase) auf eine Schicht kollabieren (seq) oder
 * wieder der obersten folgen lassen (null). Nur, wenn das Naming unter dieser
 * Perspektive erscheint und sie eine Map (nicht schreibgeschützt) oder eine
 * Phase ist; derselbe Zustand ein zweites Mal ist kein zweiter Akt — auch bei
 * zwei gleichzeitigen Klicks (die Erscheinung wird gesperrt und neu gelesen).
 */
export async function collapsePerspective(params: {
	namingId: string;
	perspectiveId: string;
	projectId: string;
	userId: string;
	seq: number | string | null;
}) {
	const { namingId, perspectiveId, projectId, userId, seq } = params;
	const app = await queryOne<{ kind: string | null; read_only: boolean }>(
		`SELECT CASE WHEN ps.properties ? 'mapType' THEN 'map'
		             WHEN ps.properties->>'role' = 'phase' THEN 'phase' END AS kind,
		        COALESCE((ps.properties->>'readOnly')::boolean, false) AS read_only
		   FROM appearances a
		   JOIN namings n ON n.id = a.naming_id AND n.project_id = $3 AND n.deleted_at IS NULL
		   JOIN namings p ON p.id = a.perspective_id AND p.project_id = $3 AND p.deleted_at IS NULL
		   JOIN appearances ps ON ps.naming_id = p.id AND ps.perspective_id = p.id AND ps.mode = 'perspective'
		  WHERE a.naming_id = $1 AND a.perspective_id = $2 AND a.naming_id <> a.perspective_id`,
		[namingId, perspectiveId, projectId]
	);
	if (!app || !app.kind) throw new StackLayerError('This naming does not appear on that map or phase.', 404);
	if (app.read_only) throw new StackLayerError('This map is read-only (template). Copy the project to make changes.', 403);

	let state: LayerState | null = null;
	if (seq !== null) {
		const s = parseSeq(seq);
		state = s ? await getLayerState(namingId, s) : null;
		if (!state) throw new StackLayerError('That layer is not part of this naming’s stack.', 404);
	}
	const target = state ? String(state.layer_seq) : null;

	const by = await getOrCreateResearcherNaming(projectId, userId);
	const changed = await transaction(async (client) => {
		const cur = (
			await client.query(
				`SELECT collapse_seq(properties)::text AS at, properties ? 'collapseAt' AS has
				   FROM appearances WHERE naming_id = $1 AND perspective_id = $2 FOR UPDATE`,
				[namingId, perspectiveId]
			)
		).rows[0] as { at: string | null; has: boolean } | undefined;
		if (!cur) return false;
		if (target === null ? !cur.has : cur.at === target) return false;
		if (target === null) {
			await client.query(
				`UPDATE appearances SET properties = properties - 'collapseAt', updated_at = now()
				  WHERE naming_id = $1 AND perspective_id = $2`,
				[namingId, perspectiveId]
			);
		} else {
			await client.query(
				`UPDATE appearances
				    SET properties = COALESCE(properties, '{}'::jsonb) || jsonb_build_object('collapseAt', $3::bigint),
				        updated_at = now()
				  WHERE naming_id = $1 AND perspective_id = $2`,
				[namingId, perspectiveId, target]
			);
		}
		await client.query(
			`INSERT INTO situating_acts (map_id, naming_id, by, act, collapse_at)
			 VALUES ($1, $2, $3, $4, $5)`,
			[perspectiveId, namingId, by, target === null ? 'release' : 'collapse', target]
		);
		return true;
	});
	return { changed, collapseAt: target, state };
}

/**
 * Ein Akt, der auf einer Map eine neue oberste Schicht setzt (Umbenennen,
 * Designieren, Aktivieren, ein Memo, das einen Cue hebt): Zeigte diese Map
 * eine frühere Schicht, folgt sie danach der obersten — man sieht, was man
 * dort getan hat (S08: Änderungen auf einer Map gehen in denselben Stack).
 * Die Rückkehr ist ein Akt wie jeder Kollaps; andere Maps und Phasen
 * behalten ihren Index (S09). Gibt zurück, ob die Map zurückkehrte.
 */
export async function followTopmostOn(params: { namingId: string; mapId: string; projectId: string; userId: string }) {
	try {
		const r = await collapsePerspective({ ...params, perspectiveId: params.mapId, seq: null });
		return r.changed;
	} catch (e) {
		if (e instanceof StackLayerError) return false;
		throw e;
	}
}

const norm = (v: string | null | undefined) => (v === undefined || v === null || v === '' ? null : v);

/**
 * Eine frühere Schicht im Datenraum wieder zur obersten machen: ein neuer Akt,
 * der Inschrift, Designation und Valenz dieser Schicht aufnimmt. Mit Notiz
 * gilt die allgemeine Regel: ein reflektierter Cue ist mindestens eine
 * Characterization (BJ, S08; „MEMOS ADVANCEN EINE ENTITÄT VOM CUE ZUR
 * CHARACTERIZATION", 09.11.). Ändert die Schicht nichts, ist das kein Akt
 * (409), auch nicht mit Notiz — die gehört dann als Memo in den Stack.
 * Nur Forschende — KI-Pfade schreiben nur Cues.
 */
export async function activateLayer(params: {
	namingId: string;
	projectId: string;
	userId: string;
	seq: number | string;
	note?: { text?: string | null; linkedNamingIds?: string[] | null };
}) {
	const { namingId, projectId, userId, seq, note } = params;
	if (userId === AI_SYSTEM_USER_ID) throw new StackLayerError('Only researchers activate layers.', 403);
	const naming = await queryOne<{ inscription: string; relation_valence: string | null }>(
		`SELECT n.inscription,
		        (SELECT a.valence FROM appearances a WHERE a.naming_id = n.id AND a.mode = 'relation'
		          ORDER BY a.updated_at DESC NULLS LAST LIMIT 1) AS relation_valence
		   FROM namings n WHERE n.id = $1 AND n.project_id = $2 AND n.deleted_at IS NULL`,
		[namingId, projectId]
	);
	if (!naming) throw new StackLayerError('naming not found in project', 404);
	const s = parseSeq(seq);
	const state = s ? await getLayerState(namingId, s) : null;
	if (!state) throw new StackLayerError('That layer is not part of this naming’s stack.', 404);
	const top = await getTopState(namingId);

	const text = note?.text?.trim() || null;
	const links = (note?.linkedNamingIds ?? []).filter((id) => typeof id === 'string' && id);
	const currentDes = top?.designation ?? 'cue';
	const currentVal = norm(top?.valence !== null && top?.valence !== undefined ? top.valence : naming.relation_valence);
	let des = state.designation;
	let lifted = false;
	if (text && des === 'cue') {
		des = 'characterization';
		lifted = true;
	}
	// '' ist ein Zustand: ohne eigenen Namen (Relation).
	const newIns = state.inscription !== null && state.inscription !== naming.inscription ? state.inscription : null;
	const newDes = des !== currentDes ? des : null;
	// Valenz nur, wenn die Schicht eine erfasst hat ('' = keine).
	const newVal = state.valence !== null && norm(state.valence) !== currentVal ? state.valence : null;
	if (newIns === null && newDes === null && newVal === null) {
		throw new StackLayerError('This layer is already the current state of the naming.', 409);
	}

	const by = await getOrCreateResearcherNaming(projectId, userId);
	const act = await transaction(async (client) => {
		if (newIns !== null) {
			await client.query(
				`UPDATE namings SET inscription = $1 WHERE id = $2 AND project_id = $3 AND deleted_at IS NULL`,
				[newIns, namingId, projectId]
			);
		}
		if (newVal !== null) {
			await client.query(
				`UPDATE appearances SET valence = $2, updated_at = now()
				  WHERE naming_id = $1 AND mode = 'relation' AND valence IS DISTINCT FROM $2`,
				[namingId, norm(newVal)]
			);
		}
		return (
			await client.query(
				`INSERT INTO naming_acts (naming_id, by, inscription, designation, valence, memo_text, linked_naming_ids, activates_seq)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING seq, created_at`,
				[namingId, by, newIns, newDes, newVal, text, links.length > 0 ? links : null, state.layer_seq]
			)
		).rows[0];
	});
	return {
		act,
		inscription: newIns ?? naming.inscription,
		designation: newDes ?? currentDes,
		liftedTo: lifted && newDes ? newDes : null,
		layer: state
	};
}

/**
 * Unter welchen Perspektiven das Naming erscheint und welche Schicht jede
 * zeigt (null = folgt der obersten). Maps (mapType) und Phasen (role 'phase').
 * recorded: ob der Kollaps als Akt im Stack steht (Indizes von vor dem
 * 17.11.2026 wurden nicht festgehalten). readOnly: Vorlagen-Map.
 */
export async function getPerspectiveIndices(namingId: string, projectId: string) {
	return (
		await query<{
			id: string;
			label: string;
			kind: 'map' | 'phase';
			collapse_at: string | null;
			layer_seq: string | null;
			recorded: boolean;
			read_only: boolean;
		}>(
			`SELECT p.id, p.inscription AS label,
			        CASE WHEN ps.properties->>'role' = 'phase' THEN 'phase' ELSE 'map' END AS kind,
			        collapse_seq(a.properties)::text AS collapse_at,
			        -- die Schicht, die den gezeigten Zustand setzt
			        s.state_seq AS layer_seq,
			        s.state_seq IS NULL OR EXISTS (
			          SELECT 1 FROM situating_acts sa
			           WHERE sa.naming_id = a.naming_id AND sa.map_id = a.perspective_id AND sa.act = 'collapse'
			        ) OR EXISTS (
			          SELECT 1 FROM phase_memberships pm
			           WHERE pm.naming_id = a.naming_id AND pm.phase_id = a.perspective_id AND pm.action = 'assign'
			        ) AS recorded,
			        COALESCE((ps.properties->>'readOnly')::boolean, false) AS read_only
			   FROM appearances a
			   JOIN namings n ON n.id = a.naming_id AND n.project_id = $2
			   JOIN namings p ON p.id = a.perspective_id AND p.project_id = $2 AND p.deleted_at IS NULL
			   JOIN appearances ps ON ps.naming_id = p.id AND ps.perspective_id = p.id AND ps.mode = 'perspective'
			    AND (ps.properties ? 'mapType' OR ps.properties->>'role' = 'phase')
			   LEFT JOIN LATERAL naming_state_at(a.naming_id, collapse_seq(a.properties)) s
			     ON collapse_seq(a.properties) IS NOT NULL
			  WHERE a.naming_id = $1 AND a.perspective_id <> a.naming_id
			  ORDER BY kind, p.inscription`,
			[namingId, projectId]
		)
	).rows;
}
