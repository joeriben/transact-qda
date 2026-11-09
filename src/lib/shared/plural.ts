// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

/** „1 memo", „2 memos" — statt „1 memo(s)". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Nur das Wort, passend zur Zahl („Naming"/„Namings"). */
export function noun(n: number, one: string, many: string = `${one}s`): string {
	return n === 1 ? one : many;
}
