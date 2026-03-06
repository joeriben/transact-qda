<script lang="ts">
	let { data } = $props();
	const p = $derived(data.project);
	const c = $derived(data.counts);
</script>

<h1>Project Overview</h1>
<div class="stats">
	<div class="stat">
		<span class="val">{c.documents}</span>
		<span class="lbl">Documents</span>
	</div>
	<div class="stat">
		<span class="val">{c.codes}</span>
		<span class="lbl">Codes</span>
	</div>
	<div class="stat">
		<span class="val">{c.maps}</span>
		<span class="lbl">Maps</span>
	</div>
	<div class="stat">
		<span class="val">{c.memos}</span>
		<span class="lbl">Memos</span>
	</div>
</div>

<style>
	h1 { font-size: 1.3rem; margin-bottom: 1.5rem; }

	.stats {
		display: flex;
		gap: 1rem;
	}

	.stat {
		background: #161822;
		border: 1px solid #2a2d3a;
		border-radius: 8px;
		padding: 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		min-width: 120px;
	}

	.val {
		font-size: 1.8rem;
		font-weight: 700;
		color: #a5b4fc;
	}

	.lbl {
		font-size: 0.8rem;
		color: #6b7280;
		margin-top: 0.25rem;
	}
</style>
