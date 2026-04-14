// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

export function createSelection() {
	let selectedIds = $state<Set<string>>(new Set());

	function select(id: string, additive = false) {
		if (additive) {
			const next = new Set(selectedIds);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			selectedIds = next;
		} else {
			selectedIds = new Set([id]);
		}
	}

	function clear() {
		selectedIds = new Set();
	}

	function isSelected(id: string): boolean {
		return selectedIds.has(id);
	}

	return {
		get ids() { return selectedIds; },
		get count() { return selectedIds.size; },
		select,
		clear,
		isSelected
	};
}
