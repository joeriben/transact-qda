// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getContext, setContext } from 'svelte';
import { runAiStream } from './aiStream.js';

const COACH_KEY = Symbol('coach');

export type CoachMessage = {
	role: 'user' | 'assistant';
	content: string;
};

export type CoachState = ReturnType<typeof createCoachState>;

export function createCoachState(projectId: string) {
	const STORAGE_KEY = `coach-${projectId}`;

	// Load from sessionStorage
	let messages = $state<CoachMessage[]>(loadFromSession());
	let isOpen = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	// Laufender Schritt (Werkzeugname) und Startzeit — für die Ladeanzeige.
	let step = $state<string | null>(null);
	let startedAt = $state<number | null>(null);
	let abortCtl: AbortController | null = null;

	function loadFromSession(): CoachMessage[] {
		if (typeof sessionStorage === 'undefined') return [];
		try {
			const raw = sessionStorage.getItem(STORAGE_KEY);
			return raw ? JSON.parse(raw) : [];
		} catch {
			return [];
		}
	}

	function saveToSession() {
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
		} catch {
			// sessionStorage full or unavailable — ignore
		}
	}

	// Sync to sessionStorage on changes
	$effect(() => {
		// Serialize triggers dependency on the full array content
		JSON.stringify(messages);
		saveToSession();
	});

	/** false, wenn keine Antwort kam — die Frage ist dann wieder aus dem Verlauf genommen. */
	async function send(message: string, currentPage: string, currentMapId?: string): Promise<boolean> {
		messages.push({ role: 'user', content: message });
		loading = true;
		error = null;
		step = null;
		startedAt = Date.now();
		abortCtl = new AbortController();

		try {
			const last = await runAiStream(
				`/api/projects/${projectId}/coach`,
				{
					message,
					history: messages.slice(0, -1), // all except the just-added user message
					currentPage,
					currentMapId
				},
				(event) => {
					if (event.kind === 'step' && typeof event.tool === 'string') step = event.tool;
				},
				abortCtl.signal
			);

			if (last.kind === 'cancelled') {
				throw new Error('Stopped. Your question is back in the input field.');
			}
			if (last.kind !== 'done' || typeof last.response !== 'string' || !last.response.trim()) {
				const reason = typeof last.message === 'string' && last.message ? last.message : 'no answer arrived';
				throw new Error(`The coach could not answer: ${reason}`);
			}

			messages.push({ role: 'assistant', content: last.response });
			return true;
		} catch (e: any) {
			error = e.message || 'Unknown error';
			// Remove the failed user message
			messages.pop();
			return false;
		} finally {
			loading = false;
			step = null;
			startedAt = null;
			abortCtl = null;
		}
	}

	/** Laufende Antwort anhalten — auch serverseitig. */
	function stop() {
		abortCtl?.abort();
	}

	function clear() {
		messages = [];
		error = null;
	}

	return {
		get messages() { return messages; },
		get isOpen() { return isOpen; },
		set isOpen(v: boolean) { isOpen = v; },
		get loading() { return loading; },
		get error() { return error; },
		get step() { return step; },
		get startedAt() { return startedAt; },
		send,
		stop,
		clear
	};
}

export function setCoachState(state: CoachState) {
	setContext(COACH_KEY, state);
}

export function getCoachState(): CoachState {
	return getContext<CoachState>(COACH_KEY);
}
