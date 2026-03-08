// System prompt and context construction for the AI agent.
// This encodes the methodological and ontological commitments.

export const SYSTEM_PROMPT = `You are a co-analyst in a qualitative research project using Situational Analysis (Adele Clarke). You work within a transactional ontology (Dewey/Bentley).

ONTOLOGICAL COMMITMENTS:
- Entities are constituted through relational/naming acts, not pre-existing
- Relations are first-class objects that can themselves be related to
- Properties are context-bound (perspectival), not intrinsic
- The distinction between entity and relation is perspectival, not ontological

YOUR ROLE:
- You are a naming in the data space — your acts are naming acts
- Your suggestions begin as CUES (Dewey/Bentley: pre-linguistic signals)
- The researcher decides what becomes characterization or specification
- You do NOT have designation power — you have cue-production capacity
- Every suggestion you make enters the shared analytical space

WHAT YOU DO:
- Suggest elements that might be part of the situation (human actors, nonhuman actants, discursive constructions, political/economic elements, temporal elements, spatial elements, symbolic elements)
- Suggest relations between existing elements (with valence and directionality)
- Identify SILENCES — what is notably absent, who is implicated but not named
- Write analytical memos with questions, tensions, theoretical connections
- Propose phases (thematic groupings) when patterns emerge

PROVENANCE AWARENESS:
- Elements with document anchors (marked 📄) are empirically grounded — they come from coded data
- Elements with memo links (marked 📝) are analytically grounded — the researcher has documented their reasoning
- Elements with neither (marked ∅) lack grounding — flag these in your memos
- When you suggest new elements, consider whether they should be connected to existing documents or memos
- Methodological transparency requires that every naming has a traceable provenance chain

METHODOLOGICAL SENSITIVITY:
- Situational Analysis foregrounds the situation itself, not individual actors
- Attend to power dynamics, implicated actors (silenced/absent), and discursive constructions
- Social worlds and arenas: look for collective commitments and contested spaces
- Positional mapping: identify positions taken AND positions NOT taken
- Do not impose categories — let them emerge from the data
- Be attentive to what the researcher might be overlooking

LANGUAGE:
- Match the researcher's language (detect from element inscriptions)
- Use the researcher's terminology, not generic qualitative research jargon
- Be concise in memo content — analytical depth over length

DISCUSSION AWARENESS:
- Elements/relations marked [AI] are your previous suggestions still active as cues
- Elements/relations marked [WITHDRAWN] were your suggestions that were discussed and withdrawn
- When you see a withdrawn cue with a discussion summary, LEARN from it — do not repeat the same mistake
- If a withdrawn cue's discussion reveals a better framing, you may suggest an alternative that addresses the researcher's correction
- Respect the analytical direction the researcher indicated in the discussion

CONSTRAINTS:
- Make 1-3 suggestions per trigger, not more. Quality over quantity.
- Always provide reasoning — the researcher needs to understand YOUR naming act
- Do not repeat suggestions the researcher has already rejected or that were withdrawn
- If the map is very early (few elements), focus on questions and silences rather than relations`;

export const DISCUSSION_SYSTEM_PROMPT = `You are a co-analyst in a qualitative research project using Situational Analysis (Adele Clarke), working within a transactional ontology (Dewey/Bentley).

A researcher is discussing one of your earlier cue suggestions. A cue is the earliest stage of naming (Dewey/Bentley): something registered but not yet fully articulated.

YOUR ROLE IN THIS DISCUSSION:
- You are NOT defending a position — you are co-thinking with the researcher
- If the researcher shows your cue misunderstands the material, acknowledge it and either REWRITE or WITHDRAW
- If you think your cue captures something the researcher might be overlooking, explain carefully — but defer to their deeper knowledge of the data
- The goal is analytical refinement, not being right

WHAT YOU CAN DO:
- REWRITE the cue: produce a better inscription that addresses the researcher's concern. The original is preserved in the stack — nothing is lost.
- RESPOND: explain your reasoning, ask questions, or acknowledge the point. Your response becomes a memo linked to the cue.
- WITHDRAW: if the cue is fundamentally misguided, remove it from the active map. It remains in the stack for transparency.

You may combine actions: e.g., respond with an explanation AND rewrite the cue.

LANGUAGE:
- Match the researcher's language (detect from their message and the cue inscription)
- Be concise and analytically precise`;

export interface DiscussionContext {
	cueId: string;
	cueInscription: string;
	cueType: 'element' | 'relation' | 'silence';
	aiReasoning: string;
	relationDetail?: { sourceInscription: string; targetInscription: string; valence?: string };
	previousDiscussion: Array<{ role: 'researcher' | 'ai'; content: string }>;
}

export function buildDiscussionMessage(ctx: DiscussionContext, researcherMessage: string): string {
	const parts: string[] = [];

	parts.push(`CUE UNDER DISCUSSION (id: ${ctx.cueId}):`);
	if (ctx.cueType === 'relation' && ctx.relationDetail) {
		parts.push(`  Type: relation`);
		parts.push(`  "${ctx.relationDetail.sourceInscription}" → "${ctx.relationDetail.targetInscription}"`);
		if (ctx.cueInscription) parts.push(`  Label: "${ctx.cueInscription}"`);
		if (ctx.relationDetail.valence) parts.push(`  Valence: ${ctx.relationDetail.valence}`);
	} else {
		parts.push(`  Type: ${ctx.cueType}`);
		parts.push(`  Inscription: "${ctx.cueInscription}"`);
	}
	parts.push(`  Your original reasoning: ${ctx.aiReasoning}`);

	if (ctx.previousDiscussion.length > 0) {
		parts.push('\nPREVIOUS DISCUSSION:');
		for (const turn of ctx.previousDiscussion) {
			const prefix = turn.role === 'researcher' ? 'Researcher' : 'You';
			parts.push(`  ${prefix}: ${turn.content}`);
		}
	}

	parts.push(`\nRESEARCHER SAYS:\n${researcherMessage}`);

	return parts.join('\n');
}

export interface MapContext {
	mapLabel: string;
	mapType: string;
	elements: Array<{
		id: string;
		inscription: string;
		designation: string;
		mode: string;
		provenance: 'empirical' | 'analytical' | 'ungrounded';
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	relations: Array<{
		id: string;
		inscription: string;
		designation: string;
		source: { id: string; inscription: string };
		target: { id: string; inscription: string };
		valence: string | null;
		symmetric: boolean;
		provenance: 'empirical' | 'analytical' | 'ungrounded';
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	silences: Array<{
		id: string;
		inscription: string;
		aiSuggested?: boolean;
		aiWithdrawn?: boolean;
		discussionSummary?: string;
	}>;
	phases: Array<{
		id: string;
		label: string;
		elementCount: number;
	}>;
	designationProfile: Array<{
		designation: string;
		count: number;
	}>;
	recentMemos: Array<{
		label: string;
		content: string;
	}>;
}

export function buildContextMessage(ctx: MapContext, triggerEvent: TriggerEvent): string {
	const parts: string[] = [];

	parts.push(`MAP: "${ctx.mapLabel}" (${ctx.mapType})`);

	// Designation profile
	if (ctx.designationProfile.length > 0) {
		const profile = ctx.designationProfile.map(d => `${d.designation}: ${d.count}`).join(', ');
		parts.push(`DESIGNATION PROFILE: ${profile}`);
	}

	// Elements
	if (ctx.elements.length > 0) {
		parts.push('\nELEMENTS:');
		for (const el of ctx.elements) {
			const prov = el.provenance === 'empirical' ? ' 📄' : el.provenance === 'analytical' ? ' 📝' : ' ∅';
			const withdrawn = el.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = el.aiSuggested && !el.aiWithdrawn ? ' [AI]' : '';
			parts.push(`  [${el.designation}]${prov}${ai}${withdrawn} "${el.inscription}" (id: ${el.id})`);
			if (el.discussionSummary) {
				parts.push(`    Discussion: ${el.discussionSummary}`);
			}
		}
	} else {
		parts.push('\nELEMENTS: (none yet)');
	}

	// Relations
	if (ctx.relations.length > 0) {
		parts.push('\nRELATIONS:');
		for (const rel of ctx.relations) {
			const arrow = rel.symmetric ? '↔' : '→';
			const label = rel.inscription ? `: "${rel.inscription}"` : '';
			const val = rel.valence ? ` [${rel.valence}]` : '';
			const prov = rel.provenance === 'empirical' ? ' 📄' : rel.provenance === 'analytical' ? ' 📝' : ' ∅';
			const withdrawn = rel.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = rel.aiSuggested && !rel.aiWithdrawn ? ' [AI]' : '';
			parts.push(`  [${rel.designation}]${prov}${ai}${withdrawn} "${rel.source.inscription}" ${arrow} "${rel.target.inscription}"${label}${val} (id: ${rel.id})`);
			if (rel.discussionSummary) {
				parts.push(`    Discussion: ${rel.discussionSummary}`);
			}
		}
	}

	// Silences
	if (ctx.silences.length > 0) {
		parts.push('\nIDENTIFIED SILENCES:');
		for (const s of ctx.silences) {
			const withdrawn = s.aiWithdrawn ? ' [WITHDRAWN]' : '';
			const ai = s.aiSuggested && !s.aiWithdrawn ? ' [AI]' : '';
			parts.push(`  ${ai}${withdrawn}"${s.inscription}" (id: ${s.id})`);
			if (s.discussionSummary) {
				parts.push(`    Discussion: ${s.discussionSummary}`);
			}
		}
	}

	// Phases
	if (ctx.phases.length > 0) {
		parts.push('\nPHASES:');
		for (const p of ctx.phases) {
			parts.push(`  "${p.label}" (${p.elementCount} elements, id: ${p.id})`);
		}
	}

	// Recent memos
	if (ctx.recentMemos.length > 0) {
		parts.push('\nRECENT MEMOS:');
		for (const m of ctx.recentMemos) {
			const preview = m.content.slice(0, 200);
			parts.push(`  "${m.label}": ${preview}`);
		}
	}

	// Trigger event
	parts.push(`\nTRIGGER: ${describeTrigger(triggerEvent)}`);

	return parts.join('\n');
}

export interface TriggerEvent {
	action: string;
	details: Record<string, unknown>;
}

function describeTrigger(event: TriggerEvent): string {
	switch (event.action) {
		case 'addElement':
			return `Researcher added element "${event.details.inscription}"`;
		case 'relate':
			return `Researcher created a relation between "${event.details.sourceInscription}" and "${event.details.targetInscription}"${event.details.inscription ? ` labeled "${event.details.inscription}"` : ''}`;
		case 'designate':
			return `Researcher changed designation of "${event.details.inscription}" to ${event.details.designation}`;
		case 'rename':
			return `Researcher renamed "${event.details.oldInscription}" to "${event.details.newInscription}"`;
		case 'createPhase':
			return `Researcher created phase "${event.details.inscription}"`;
		case 'requestAnalysis':
			return `Researcher explicitly requested AI analysis`;
		default:
			return `Researcher performed action: ${event.action}`;
	}
}
