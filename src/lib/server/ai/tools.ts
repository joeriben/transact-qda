// Claude tool definitions for the AI agent.
// Each tool maps to a naming act in the data space.

import type { ToolDef } from './client.js';

export const AI_TOOLS: ToolDef[] = [
	{
		name: 'suggest_element',
		description:
			'Suggest a new element for the situational map. Your suggestion will appear as a cue that the researcher can accept, modify, or reject.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'The name/label for the suggested element'
				},
				reasoning: {
					type: 'string',
					description: 'Why this element might be relevant to the situation'
				}
			},
			required: ['inscription', 'reasoning']
		}
	},
	{
		name: 'suggest_relation',
		description:
			'Suggest a relation between two existing elements on the map. Reference elements by their ID.',
		input_schema: {
			type: 'object' as const,
			properties: {
				source_id: {
					type: 'string',
					description: 'ID of the source element'
				},
				target_id: {
					type: 'string',
					description: 'ID of the target element'
				},
				inscription: {
					type: 'string',
					description: 'Description of the relation'
				},
				valence: {
					type: 'string',
					description: 'Nature of the relation (e.g., enables, constrains, legitimizes, silences)'
				},
				symmetric: {
					type: 'boolean',
					description: 'Whether the relation is undirected (true) or directed from source to target (false)'
				},
				reasoning: {
					type: 'string',
					description: 'Why this relation might be important'
				}
			},
			required: ['source_id', 'target_id', 'reasoning']
		}
	},
	{
		name: 'identify_silence',
		description:
			'Point out a notable absence — something or someone missing from the situational map. In Situational Analysis, silences are as analytically important as presences.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'What is absent/silenced'
				},
				reasoning: {
					type: 'string',
					description: 'Why this absence is notable given the situation'
				}
			},
			required: ['inscription', 'reasoning']
		}
	},
	{
		name: 'write_memo',
		description:
			'Write an analytical memo about the map or specific elements. Use this for observations, questions, tensions, or theoretical connections that don\'t fit into element/relation suggestions.',
		input_schema: {
			type: 'object' as const,
			properties: {
				title: {
					type: 'string',
					description: 'Memo title'
				},
				content: {
					type: 'string',
					description: 'Memo content: analytical observations, questions, theoretical connections'
				},
				linked_element_ids: {
					type: 'array',
					items: { type: 'string' },
					description: 'IDs of elements this memo relates to'
				}
			},
			required: ['title', 'content']
		}
	},
	{
		name: 'create_phase',
		description:
			'Suggest a phase (thematic grouping) for elements on the map. Phases are sub-perspectives that organize elements into meaningful clusters.',
		input_schema: {
			type: 'object' as const,
			properties: {
				inscription: {
					type: 'string',
					description: 'Name of the phase/grouping'
				},
				element_ids: {
					type: 'array',
					items: { type: 'string' },
					description: 'IDs of elements to include in this phase'
				},
				reasoning: {
					type: 'string',
					description: 'Why these elements form a meaningful grouping'
				}
			},
			required: ['inscription', 'element_ids', 'reasoning']
		}
	}
];

// ── SW/A-specific tools ──

export const SUGGEST_FORMATION_TOOL: ToolDef = {
	name: 'suggest_formation',
	description:
		'Suggest a new formation (social world, arena, discourse, or organization) for the SW/A map. Formations are universes of discourse or sites of contestation — mesolevel social organization, not just groups of elements.',
	input_schema: {
		type: 'object' as const,
		properties: {
			inscription: {
				type: 'string',
				description: 'The name/label for the suggested formation'
			},
			sw_role: {
				type: 'string',
				enum: ['social-world', 'arena', 'discourse', 'organization'],
				description: 'The formation role: social-world (universe of discourse), arena (site of contestation), discourse (discursive formation), organization (formal structure)'
			},
			reasoning: {
				type: 'string',
				description: 'Analytical justification for why this formation exists in the situation'
			}
		},
		required: ['inscription', 'sw_role', 'reasoning']
	}
};

export interface SuggestFormationInput {
	inscription: string;
	sw_role: 'social-world' | 'arena' | 'discourse' | 'organization';
	reasoning: string;
}

// ── Discussion tools: used when a researcher discusses an AI-generated cue ──

export const DISCUSSION_TOOLS: ToolDef[] = [
	{
		name: 'rewrite_cue',
		description:
			'Rewrite the cue inscription based on the discussion. This creates a new inscription layer — the original is preserved in the stack. Use this when you understand the researcher\'s objection and can produce a better naming.',
		input_schema: {
			type: 'object' as const,
			properties: {
				new_inscription: {
					type: 'string',
					description: 'The revised inscription for the cue'
				},
				reasoning: {
					type: 'string',
					description: 'Why this revision addresses the researcher\'s concern'
				}
			},
			required: ['new_inscription', 'reasoning']
		}
	},
	{
		name: 'respond',
		description:
			'Respond to the researcher without changing the cue. Use this to explain your reasoning, ask clarifying questions, or acknowledge the researcher\'s point. Your response becomes a memo linked to the cue.',
		input_schema: {
			type: 'object' as const,
			properties: {
				content: {
					type: 'string',
					description: 'Your response to the researcher'
				}
			},
			required: ['content']
		}
	},
	{
		name: 'withdraw_cue',
		description:
			'Withdraw your suggestion. Use this when the researcher has shown the cue is fundamentally misguided. The cue is marked as withdrawn but preserved in the stack for transparency.',
		input_schema: {
			type: 'object' as const,
			properties: {
				reasoning: {
					type: 'string',
					description: 'Why you agree the cue should be withdrawn'
				}
			},
			required: ['reasoning']
		}
	}
];

export interface RewriteCueInput {
	new_inscription: string;
	reasoning: string;
}

export interface RespondInput {
	content: string;
}

export interface WithdrawCueInput {
	reasoning: string;
}

// Tool call result types for the executor
export interface SuggestElementInput {
	inscription: string;
	reasoning: string;
}

export interface SuggestRelationInput {
	source_id: string;
	target_id: string;
	inscription?: string;
	valence?: string;
	symmetric?: boolean;
	reasoning: string;
}

export interface IdentifySilenceInput {
	inscription: string;
	reasoning: string;
}

export interface WriteMemoInput {
	title: string;
	content: string;
	linked_element_ids?: string[];
}

export interface CreatePhaseInput {
	inscription: string;
	element_ids: string[];
	reasoning: string;
}
