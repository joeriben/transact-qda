// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { User } from '$lib/shared/types/index.js';

declare global {
	namespace App {
		interface Locals {
			user?: User;
			sessionId?: string;
		}
	}
}

export {};
