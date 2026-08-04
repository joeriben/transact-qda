// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// @deprecated Autonoma-Endpoint — NICHT WIEDER ANSCHLIESSEN.
//
// Kein UI ruft diese Route mehr auf, und das ist Absicht: Der autonome
// Massenlauf produzierte hunderte unsystematischer Namings, deren Sichtung
// vollständig beim Menschen landete. Begründung in
// src/lib/server/ai/personas/autonomous.ts, Gegenentwurf in
// docs/design-begleiten.md. Der Schalter „autonomaEnabled" ist aus den
// Projekteinstellungen entfernt; ein Projekt, in dem das Flag aus alten
// Beständen noch true steht, kann diese Route technisch weiterhin auslösen.
//
// Die Route bleibt für Nachvollzug und für den Rollback alter Läufe
// (autonoma-runs) erhalten — nicht als Einstiegspunkt für neue Arbeit.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { runAutonomousAnalysis, type AutonomousProgress } from '$lib/server/ai/runtime/index.js';
import { queryOne } from '$lib/server/db/index.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const { projectId } = params;
	const body = await request.json().catch(() => ({}));
	const { action } = body;

	if (action === 'start') {
		// Autonoma is project-gated: opt-in via Project Settings to avoid
		// accidentally bulk-coding a non-empty project.
		const proj = await queryOne<{ properties: Record<string, unknown> | null }>(
			`SELECT properties FROM projects WHERE id = $1`,
			[projectId]
		);
		if (!proj || (proj.properties as any)?.autonomaEnabled !== true) {
			error(403, 'Autonoma is disabled for this project. Enable it in Project Settings first.');
		}
		// SSE streaming response — client sees Autonomous's thinking live
		const encoder = new TextEncoder();
		const stream = new ReadableStream({
			async start(controller) {
				const send = (event: string, data: unknown) => {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				};

				try {
					const result = await runAutonomousAnalysis(projectId, (progress) => {
						send('progress', progress);
					});

					send('done', { mapId: result.mapId, summary: result.summary, runId: result.runId });
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					send('error', { error: msg });
				} finally {
					controller.close();
				}
			}
		});

		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				'Connection': 'keep-alive'
			}
		});
	}

	return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
