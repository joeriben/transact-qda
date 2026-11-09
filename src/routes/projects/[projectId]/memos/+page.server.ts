// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PageServerLoad } from './$types.js';
import { getMemosByProject, getNamingMemosByProject } from '$lib/server/db/queries/memos.js';

export const load: PageServerLoad = async ({ params }) => {
	// Die Memo-Seite zeigt alle Memos der Forschenden: analytische und
	// Organisationsmemos (eigene Einträge) und Memos ZU einem Naming (Akte in
	// dessen Stack). KI-Begründungen gehören nicht dazu.
	const [memos, namingMemos] = await Promise.all([
		getMemosByProject(params.projectId),
		getNamingMemosByProject(params.projectId)
	]);
	return { memos, namingMemos, projectId: params.projectId };
};
