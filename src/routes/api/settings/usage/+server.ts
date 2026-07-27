// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db/index.js';

export const GET: RequestHandler = async ({ url }) => {
	const days = parseInt(url.searchParams.get('days') || '30');
	const dateFrom = url.searchParams.get('from') || null;
	const dateTo = url.searchParams.get('to') || null;

	// Build date filter
	let dateFilter: string;
	const params: (string | number)[] = [];

	if (dateFrom || dateTo) {
		if (dateFrom && dateTo) {
			dateFilter = 'created_at >= $1 AND created_at < $2::date + interval \'1 day\'';
			params.push(dateFrom, dateTo);
		} else if (dateFrom) {
			dateFilter = 'created_at >= $1';
			params.push(dateFrom);
		} else {
			dateFilter = 'created_at < $1::date + interval \'1 day\'';
			params.push(dateTo!);
		}
	} else if (days === 0) {
		dateFilter = 'TRUE';
	} else {
		dateFilter = `created_at >= now() - interval '${days} days'`;
	}

	// Totals
	const totals = await query(
		`SELECT
			count(*) as total_calls,
			coalesce(sum(input_tokens), 0) as total_input_tokens,
			coalesce(sum(output_tokens), 0) as total_output_tokens,
			coalesce(sum(tokens_used), 0) as total_tokens
		 FROM ai_interactions WHERE ${dateFilter}`,
		params
	);

	// By model
	const byModel = await query(
		`SELECT
			model,
			count(*) as calls,
			coalesce(sum(input_tokens), 0) as input_tokens,
			coalesce(sum(output_tokens), 0) as output_tokens,
			coalesce(sum(tokens_used), 0) as tokens
		 FROM ai_interactions WHERE ${dateFilter}
		 GROUP BY model ORDER BY calls DESC`,
		params
	);

	// By request type
	const byType = await query(
		`SELECT
			request_type,
			count(*) as calls,
			coalesce(sum(input_tokens), 0) as input_tokens,
			coalesce(sum(output_tokens), 0) as output_tokens,
			coalesce(sum(tokens_used), 0) as tokens
		 FROM ai_interactions WHERE ${dateFilter}
		 GROUP BY request_type ORDER BY calls DESC`,
		params
	);

	// By provider
	const byProvider = await query(
		`SELECT
			coalesce(provider, 'unknown') as provider,
			count(*) as calls,
			coalesce(sum(input_tokens), 0) as input_tokens,
			coalesce(sum(output_tokens), 0) as output_tokens,
			coalesce(sum(tokens_used), 0) as tokens
		 FROM ai_interactions WHERE ${dateFilter}
		 GROUP BY provider ORDER BY calls DESC`,
		params
	);

	// By date (last 30 entries max)
	const byDate = await query(
		`SELECT
			created_at::date as date,
			count(*) as calls,
			coalesce(sum(input_tokens), 0) as input_tokens,
			coalesce(sum(output_tokens), 0) as output_tokens,
			coalesce(sum(tokens_used), 0) as tokens
		 FROM ai_interactions WHERE ${dateFilter}
		 GROUP BY created_at::date ORDER BY date DESC LIMIT 30`,
		params
	);

	const t = totals.rows[0];
	return json({
		total_calls: parseInt(t.total_calls),
		total_input_tokens: parseInt(t.total_input_tokens),
		total_output_tokens: parseInt(t.total_output_tokens),
		total_tokens: parseInt(t.total_tokens),
		by_model: Object.fromEntries(byModel.rows.map(r => [r.model, {
			calls: parseInt(r.calls), input_tokens: parseInt(r.input_tokens),
			output_tokens: parseInt(r.output_tokens), tokens: parseInt(r.tokens)
		}])),
		by_type: Object.fromEntries(byType.rows.map(r => [r.request_type, {
			calls: parseInt(r.calls), input_tokens: parseInt(r.input_tokens),
			output_tokens: parseInt(r.output_tokens), tokens: parseInt(r.tokens)
		}])),
		by_provider: Object.fromEntries(byProvider.rows.map(r => [r.provider, {
			calls: parseInt(r.calls), input_tokens: parseInt(r.input_tokens),
			output_tokens: parseInt(r.output_tokens), tokens: parseInt(r.tokens)
		}])),
		by_date: Object.fromEntries(byDate.rows.map(r => [r.date, {
			calls: parseInt(r.calls), input_tokens: parseInt(r.input_tokens),
			output_tokens: parseInt(r.output_tokens), tokens: parseInt(r.tokens)
		}]))
	});
};
