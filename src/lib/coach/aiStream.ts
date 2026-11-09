// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Client-Seite zu streamAiRun (server/ai/sse.ts): liest die Ereignisse eines
// KI-Laufs (Coach, Cowork) aus der POST-Antwort.

export type AiRunEvent = { kind: string } & Record<string, unknown>;

/**
 * Startet den Lauf und meldet jedes Ereignis. Liefert das Schluss-Ereignis
 * (`done` oder `failed`); endet der Stream ohne eines, ein `failed`.
 * Mit `signal` lässt sich der Lauf anhalten (`cancelled`): Der Server bricht
 * dann seine laufenden Modellaufrufe ab (streamAiRun, cancel()).
 */
export async function runAiStream(
	url: string,
	body: unknown,
	onEvent: (event: AiRunEvent) => void,
	signal?: AbortSignal
): Promise<AiRunEvent> {
	const stopped: AiRunEvent = { kind: 'cancelled', message: 'Stopped.' };
	let res: Response;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal
		});
	} catch (e) {
		if (signal?.aborted) return stopped;
		return { kind: 'failed', message: `No connection to the server (${e instanceof Error ? e.message : String(e)})` };
	}

	if (!res.ok || !res.body) {
		let message = `HTTP ${res.status}`;
		try {
			const data = await res.json();
			if (typeof data?.error === 'string') message = data.error;
			else if (typeof data?.message === 'string') message = data.message;
		} catch {
			/* kein JSON */
		}
		return { kind: 'failed', message };
	}

	const reader = res.body.getReader();
	const utf8 = new TextDecoder();
	let buffer = '';
	let last: AiRunEvent | null = null;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += utf8.decode(value, { stream: true });
			let idx: number;
			while ((idx = buffer.indexOf('\n\n')) !== -1) {
				const raw = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 2);
				const line = raw.split('\n').find((l) => l.startsWith('data: '));
				if (!line) continue;
				let event: AiRunEvent;
				try {
					event = JSON.parse(line.slice(6));
				} catch {
					continue;
				}
				onEvent(event);
				if (event.kind === 'done' || event.kind === 'failed') last = event;
			}
		}
	} catch (e) {
		if (signal?.aborted) return stopped;
		return { kind: 'failed', message: `Connection lost (${e instanceof Error ? e.message : String(e)})` };
	}
	if (signal?.aborted && !last) return stopped;
	return last ?? { kind: 'failed', message: 'The server ended the run without a result.' };
}

const STEP_LABELS: Record<string, string> = {
	search_manual: 'Searching the manual',
	search_namings: 'Searching namings',
	search_memos: 'Searching memos',
	search_documents: 'Searching documents',
	search_related_passages: 'Looking for related passages',
	delegate_task: 'Asking a helper model',
	create_ticket: 'Noting a platform issue',
	write_memo: 'Writing a memo',
	suggest_element: 'Writing a cue',
	suggest_relation: 'Writing a cue',
	identify_silence: 'Writing a cue',
	suggest_formation: 'Writing a cue',
	suggest_position: 'Writing a cue',
	identify_empty_region: 'Writing a cue',
	suggest_axis_refinement: 'Writing a memo',
	create_phase: 'Proposing a phase'
};

/** Lesbare Beschreibung eines Werkzeugschritts. */
export function stepLabel(tool: string | null | undefined): string {
	if (!tool) return 'Thinking';
	return STEP_LABELS[tool] ?? 'Working';
}
