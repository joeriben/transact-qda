// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// Ein Datumsformat für die ganze Oberfläche (Stack, Memos, Naming-Seiten,
// Snapshots): „9 Nov 2026, 04:13". Fest englisch wie die Oberfläche und
// eindeutig — die Schreibweise des Browsers wich zwischen Server- und
// Browser-Darstellung ab („09.11.26" neben „11/09/26 04:13 AM").

const WHEN = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function toDate(ts: string | number | Date | null | undefined): Date | null {
	if (ts == null || ts === '') return null;
	const d = ts instanceof Date ? ts : new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function formatWhen(ts: string | number | Date | null | undefined): string {
	const d = toDate(ts);
	return d ? WHEN.format(d) : '';
}

export function formatDay(ts: string | number | Date | null | undefined): string {
	const d = toDate(ts);
	return d ? DAY.format(d) : '';
}
