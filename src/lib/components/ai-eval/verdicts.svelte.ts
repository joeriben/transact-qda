// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Shared verdict state for the SEPARABLE AI-Evaluation audit layer.
//
// One fetch per document, two readers: the reader page greys out a cue whose
// last verdict is `reject`, and AiEvalControl shows the full verdict history at
// the cue. Both see the same rows, so a verdict given in the control takes
// effect in the list immediately.
//
// The verdict lives HERE, in the audit plane — never on the core row. Greying is
// a consequence of the audit record, so removing this layer removes the greying
// and leaves the material untouched. Hiding is the opposite case: it is a
// decision about the material and therefore a core flag (`properties.hidden`),
// set through the core annotations endpoint.
//
// Removal contract: this file goes with src/lib/components/ai-eval.

export type Verdict = 'accept' | 'reject' | 'revise';

export interface EvalRow {
	id: string;
	subjectNamingId: string | null;
	subjectLabel: string;
	anchor: { pos0: number; pos1: number; text: string | null } | null;
	verdict: Verdict;
	rationale: string | null;
	betterReading: string | null;
	createdAt: string;
}

/** Same cue, same passage — a verdict is given at one anchor, not on a naming in general. */
function sameAnchor(
	a: { pos0?: number | null; pos1?: number | null } | null | undefined,
	b: { pos0?: number | null; pos1?: number | null } | null | undefined
): boolean {
	if (!a || !b) return true; // an anchorless verdict speaks for the naming as such
	return a.pos0 === b.pos0 && a.pos1 === b.pos1;
}

class VerdictStore {
	rows = $state<EvalRow[]>([]);
	loaded = $state(false);
	#key = '';
	#inflight: Promise<void> | null = null;

	/** Load the verdicts of one document. Repeated calls for the same document are free. */
	async load(projectId: string, docId: string): Promise<void> {
		const key = `${projectId}/${docId}`;
		if (key === this.#key && (this.loaded || this.#inflight)) {
			await this.#inflight;
			return;
		}
		this.#key = key;
		this.loaded = false;
		this.rows = [];
		this.#inflight = (async () => {
			try {
				const res = await fetch(`/api/projects/${projectId}/documents/${docId}/ai-eval`);
				if (!res.ok) return;
				const body = (await res.json()) as { evaluations: EvalRow[] };
				if (this.#key !== key) return; // document changed while loading
				this.rows = body.evaluations ?? [];
			} catch {
				// Non-fatal: without verdicts nothing greys out, everything stays usable.
			} finally {
				if (this.#key === key) this.loaded = true;
				this.#inflight = null;
			}
		})();
		await this.#inflight;
	}

	add(row: EvalRow): void {
		this.rows = [...this.rows, row];
	}

	/** Verdict history for one cue at one passage, oldest first. */
	forSubject(
		namingId: string | null,
		anchor?: { pos0?: number | null; pos1?: number | null } | null
	): EvalRow[] {
		if (!namingId) return [];
		return this.rows.filter((r) => r.subjectNamingId === namingId && sameAnchor(r.anchor, anchor));
	}

	latestFor(
		namingId: string | null,
		anchor?: { pos0?: number | null; pos1?: number | null } | null
	): EvalRow | null {
		const rows = this.forSubject(namingId, anchor);
		return rows.length ? rows[rows.length - 1] : null;
	}

	/** The cue was rejected and not re-judged since — the reader greys it. */
	isRejected(
		namingId: string | null,
		anchor?: { pos0?: number | null; pos1?: number | null } | null
	): boolean {
		return this.latestFor(namingId, anchor)?.verdict === 'reject';
	}
}

export const verdicts = new VerdictStore();
