// Raichel persona definition: autonomous researcher.
// NOT YET IMPLEMENTED — this is a stub with safeguards.
//
// Raichel acts like a human user: codes documents, creates namings and relations.
// CRITICAL safeguards:
// - Must NOT be activatable in existing projects
// - Only in fresh projects or explicit copies created for autonomous analysis
// - Project metadata must clearly indicate Raichel-mode
// - Minimum precondition: at least 1 document uploaded
// - Self-triggering with GTA/SA phase guidance
// - Cairrie critically reviews Raichel's output

import { registerPersona, type Persona } from './types.js';

const raichelPersona: Persona = {
	name: 'raichel',
	displayName: 'Raichel',
	description: 'Autonomous researcher: codes documents, creates namings and relations independently. Only available in dedicated Raichel-mode projects. Output is critically reviewed by Cairrie.',
	canWrite: true,
	canDelegate: true,

	systemPromptAdditions: `[RAICHEL IS NOT YET IMPLEMENTED]
This persona is under development. Do not activate.`,

	getTools() {
		// Not yet implemented — return empty
		return [];
	},

	contextNeeds: {
		projectOverview: true,
		mapDetail: true,
		memos: true,
		library: true,
		documents: true // Raichel needs document access for coding
	}
};

registerPersona(raichelPersona);
export default raichelPersona;
