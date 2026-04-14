// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

// In the transactional ontology, namings ARE events.
// The sequence of namings IS the event log.
export { getHistory as getEventsByProject } from './namings.js';
