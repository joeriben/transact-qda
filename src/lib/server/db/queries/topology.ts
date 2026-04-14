// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { query, queryOne } from '../index.js';

// Save or overwrite the auto-buffer (seq 0)
export async function saveTopologyBuffer(mapId: string, positions: Record<string, { x: number; y: number }>) {
	await query(
		`INSERT INTO topology_snapshots (map_id, seq, label, positions)
		 VALUES ($1, 0, NULL, $2)
		 ON CONFLICT (map_id, seq)
		 DO UPDATE SET positions = $2, created_at = now()`,
		[mapId, JSON.stringify(positions)]
	);
}

// Create a named snapshot (next seq after current max)
// If positions are provided (from the client), use them directly.
// Otherwise fall back to the buffer (seq 0) or DB appearances.
export async function saveTopologySnapshot(
	mapId: string,
	label?: string,
	clientPositions?: Record<string, { x: number; y: number }>
) {
	const maxSeq = await queryOne<{ max: number }>(
		`SELECT COALESCE(MAX(seq), 0) as max FROM topology_snapshots WHERE map_id = $1 AND seq > 0`,
		[mapId]
	);
	const nextSeq = (maxSeq?.max || 0) + 1;

	let positions: Record<string, unknown>;
	if (clientPositions) {
		positions = clientPositions;
	} else {
		const buffer = await queryOne<{ positions: Record<string, unknown> }>(
			`SELECT positions FROM topology_snapshots WHERE map_id = $1 AND seq = 0`,
			[mapId]
		);
		positions = buffer ? buffer.positions : await collectCurrentPositions(mapId);
	}

	const result = await queryOne(
		`INSERT INTO topology_snapshots (map_id, seq, label, positions)
		 VALUES ($1, $2, $3, $4)
		 RETURNING *`,
		[mapId, nextSeq, label || `Snapshot ${nextSeq}`, JSON.stringify(positions)]
	);
	return result;
}

// Restore a snapshot: overwrite appearance positions
export async function restoreTopologySnapshot(mapId: string, seq: number) {
	const snapshot = await queryOne<{ positions: Record<string, { x: number; y: number }> }>(
		`SELECT positions FROM topology_snapshots WHERE map_id = $1 AND seq = $2`,
		[mapId, seq]
	);
	if (!snapshot) return null;

	for (const [namingId, pos] of Object.entries(snapshot.positions)) {
		await query(
			`UPDATE appearances SET properties = COALESCE(properties, '{}'::jsonb) || $1::jsonb, updated_at = now()
			 WHERE naming_id = $2 AND perspective_id = $3`,
			[JSON.stringify({ x: pos.x, y: pos.y }), namingId, mapId]
		);
	}
	return snapshot;
}

// List all snapshots for a map
export async function listTopologySnapshots(mapId: string) {
	return (await query(
		`SELECT id, seq, label, created_at,
		        (SELECT COUNT(*) FROM jsonb_object_keys(positions)) as node_count
		 FROM topology_snapshots
		 WHERE map_id = $1 AND seq > 0
		 ORDER BY seq DESC`,
		[mapId]
	)).rows;
}

// Collect current positions from appearances
async function collectCurrentPositions(mapId: string): Promise<Record<string, { x: number; y: number }>> {
	const rows = (await query(
		`SELECT naming_id, properties->>'x' as x, properties->>'y' as y
		 FROM appearances
		 WHERE perspective_id = $1 AND naming_id != $1
		   AND properties->>'x' IS NOT NULL`,
		[mapId]
	)).rows;

	const positions: Record<string, { x: number; y: number }> = {};
	for (const r of rows) {
		positions[r.naming_id] = { x: parseFloat(r.x), y: parseFloat(r.y) };
	}
	return positions;
}
