// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	type Provider,
	PROVIDERS,
	SUPPORTED_LANGUAGES,
	loadSettings,
	saveSettings,
	readApiKey,
	writeApiKey,
	maskKey,
	testConnection
} from '$lib/server/ai/client.js';

// Die KI-Einstellungen gelten für die ganze Installation (alle Konten, alle
// Projekte). Ändern darf sie nur ein Admin-Konto, wie beim Datenbank-Export
// (BJ, 09.11.: „Ändern nur für Admin-Konten → ja, sinnvoll"). Lesen und den
// Verbindungstest darf jedes angemeldete Konto.
const isAdmin = (locals: App.Locals) => locals.user?.role === 'admin';

// GET: current AI settings + provider list with key status
export const GET: RequestHandler = async ({ locals }) => {
	const settings = loadSettings();
	const providers = Object.entries(PROVIDERS).map(([id, def]) => {
		const key = readApiKey(id as Provider);
		return {
			id,
			label: def.label,
			defaultModel: def.defaultModel,
			needsKey: !!def.keyFile,
			keyConfigured: !!key,
			keyMasked: maskKey(key),
			dsgvo: def.dsgvo,
			region: def.region
		};
	});

	return json({
		provider: settings.provider,
		model: settings.model || PROVIDERS[settings.provider].defaultModel,
		delegationAgent: settings.delegationAgent || null,
		language: settings.language || 'auto',
		languages: SUPPORTED_LANGUAGES,
		providers,
		canEdit: isAdmin(locals)
	});
};

// POST: update settings (provider, model, apiKey, delegationAgent)
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!isAdmin(locals)) {
		return json({ error: 'Only an admin account can change the AI settings of this installation.' }, { status: 403 });
	}
	const body = await request.json();
	const { provider, model, apiKey, delegationAgent, language } = body;

	if (provider && !(provider in PROVIDERS)) {
		return json({ error: `Unknown provider: ${provider}` }, { status: 400 });
	}

	// Validate delegation agent if provided
	if (delegationAgent && delegationAgent.provider && !(delegationAgent.provider in PROVIDERS)) {
		return json({ error: `Unknown delegation provider: ${delegationAgent.provider}` }, { status: 400 });
	}

	// Save API key if provided
	if (provider && apiKey !== undefined) {
		if (apiKey === '') {
			// Don't delete key file, just ignore empty string
		} else {
			writeApiKey(provider as Provider, apiKey);
		}
	}

	// Save settings
	const current = loadSettings();
	const newSettings = {
		provider: (provider as Provider) || current.provider,
		model: model !== undefined ? model : current.model,
		delegationAgent: delegationAgent !== undefined
			? (delegationAgent?.provider ? delegationAgent : undefined)
			: current.delegationAgent,
		language: language !== undefined
			? (language in SUPPORTED_LANGUAGES ? language : undefined)
			: current.language,
		// Per-tier model routing is not edited via this route (no UI yet);
		// pass it through so saving provider/model/language never wipes it.
		tiers: current.tiers
	};
	saveSettings(newSettings);

	return json({ ok: true, ...newSettings });
};
