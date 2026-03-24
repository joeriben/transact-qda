import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	type Provider,
	PROVIDERS,
	loadSettings,
	saveSettings,
	readApiKey,
	writeApiKey,
	maskKey,
	testConnection
} from '$lib/server/ai/client.js';

// GET: current AI settings + provider list with key status
export const GET: RequestHandler = async () => {
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
		providers
	});
};

// POST: update settings (provider, model, apiKey)
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { provider, model, apiKey } = body;

	if (provider && !(provider in PROVIDERS)) {
		return json({ error: `Unknown provider: ${provider}` }, { status: 400 });
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
		model: model !== undefined ? model : current.model
	};
	saveSettings(newSettings);

	return json({ ok: true, ...newSettings });
};
