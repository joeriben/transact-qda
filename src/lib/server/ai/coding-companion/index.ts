// SPDX-FileCopyrightText: 2024-2026 Benjamin Jörissen
// SPDX-License-Identifier: AGPL-3.0-or-later

export {
	retrieveComparisonMaterial,
	retrieveComparisonMaterialForText,
	type RetrievalResult,
	type SimilarPassage,
	type CodeWithGroundings,
	type PassageCode
} from './retrieval.js';

export {
	comparePassage,
	discussComparison,
	type ComparisonResult,
	type PassageComparison
} from './compare.js';
