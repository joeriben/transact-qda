<script lang="ts">
	let activeTab: 'provider' | 'usage' = $state('provider');

	// ── Provider state ────────────────────────────────────────
	interface ProviderInfo {
		id: string;
		label: string;
		defaultModel: string;
		needsKey: boolean;
		keyConfigured: boolean;
		keyMasked: string;
		dsgvo: boolean;
		region: string;
	}

	let providers = $state<ProviderInfo[]>([]);
	let selectedProvider = $state('');
	let model = $state('');
	let apiKeyInput = $state('');
	let saving = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; error?: string; model?: string } | null>(null);
	let message = $state<{ type: 'ok' | 'error'; text: string } | null>(null);
	let loading = $state(true);

	const currentProviderInfo = $derived(providers.find(p => p.id === selectedProvider));

	async function loadSettings() {
		loading = true;
		try {
			const res = await fetch('/api/settings/ai');
			const data = await res.json();
			providers = data.providers;
			selectedProvider = data.provider;
			model = data.model;
		} catch (e: any) {
			message = { type: 'error', text: e.message };
		} finally {
			loading = false;
		}
	}

	async function save() {
		saving = true;
		message = null;
		testResult = null;
		try {
			const body: Record<string, string> = { provider: selectedProvider, model };
			if (apiKeyInput) body.apiKey = apiKeyInput;
			const res = await fetch('/api/settings/ai', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) throw new Error((await res.json()).error);
			message = { type: 'ok', text: 'Settings saved.' };
			apiKeyInput = '';
			await loadSettings();
		} catch (e: any) {
			message = { type: 'error', text: e.message };
		} finally {
			saving = false;
		}
	}

	async function test() {
		testing = true;
		testResult = null;
		try {
			const res = await fetch('/api/settings/ai/test', { method: 'POST' });
			testResult = await res.json();
		} catch (e: any) {
			testResult = { ok: false, error: e.message };
		} finally {
			testing = false;
		}
	}

	function selectProvider(id: string) {
		selectedProvider = id;
		const info = providers.find(p => p.id === id);
		if (info) model = info.defaultModel;
		apiKeyInput = '';
		testResult = null;
		message = null;
	}

	// ── Usage state ───────────────────────────────────────────
	interface UsageStats { calls: number; input_tokens: number; output_tokens: number; tokens: number }

	let usageData = $state<{
		total_calls: number;
		total_input_tokens: number;
		total_output_tokens: number;
		total_tokens: number;
		by_model: Record<string, UsageStats>;
		by_type: Record<string, UsageStats>;
		by_provider: Record<string, UsageStats>;
	} | null>(null);
	let usageLoading = $state(false);
	let usageError = $state<string | null>(null);
	let activePeriod = $state('month');
	let customFrom = $state('');
	let customTo = $state('');

	const periodPresets = [
		{ key: 'today', label: 'Today', days: 1 },
		{ key: 'week', label: 'Week', days: 7 },
		{ key: 'month', label: 'Month', days: 30 },
		{ key: 'year', label: 'Year', days: 365 },
		{ key: 'all', label: 'All', days: 0 },
	];

	async function fetchUsage() {
		usageLoading = true;
		usageError = null;
		try {
			const params = new URLSearchParams();
			if (activePeriod === 'custom') {
				if (customFrom) params.set('from', customFrom);
				if (customTo) params.set('to', customTo);
			} else {
				const preset = periodPresets.find(p => p.key === activePeriod);
				if (preset) params.set('days', String(preset.days));
			}
			const qs = params.toString() ? `?${params}` : '';
			const res = await fetch(`/api/settings/usage${qs}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			usageData = await res.json();
		} catch (e: any) {
			usageError = e.message;
		} finally {
			usageLoading = false;
		}
	}

	function selectPeriod(key: string) {
		activePeriod = key;
		if (key !== 'custom') { customFrom = ''; customTo = ''; }
		fetchUsage();
	}

	function formatTokens(n: number): string {
		if (!n) return '0';
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return n.toString();
	}

	// Init
	$effect(() => {
		loadSettings();
		fetchUsage();
	});
</script>

<div class="settings-page">
	<div class="settings-header">
		<h1>Settings</h1>
		<a href="/projects" class="back-link">Back to Projects</a>
	</div>

	<div class="tabs">
		<button class="tab" class:active={activeTab === 'provider'} onclick={() => activeTab = 'provider'}>
			AI Provider
		</button>
		<button class="tab" class:active={activeTab === 'usage'} onclick={() => { activeTab = 'usage'; fetchUsage(); }}>
			Usage
		</button>
	</div>

	{#if activeTab === 'provider'}
		<!-- ═══════ Provider Config ═══════ -->
		{#if loading}
			<div class="loading">Loading...</div>
		{:else}
			<div class="section">
				<h2>Provider</h2>
				<div class="provider-grid">
					{#each providers as p}
						<button
							class="provider-card"
							class:selected={selectedProvider === p.id}
							onclick={() => selectProvider(p.id)}
						>
							<div class="provider-name">{p.label}</div>
							<div class="provider-meta">
								<span class:dsgvo-ok={p.dsgvo} class:dsgvo-warn={!p.dsgvo}>
									{p.dsgvo ? 'DSGVO' : 'Non-EU'}
								</span>
								<span class="provider-region">{p.region}</span>
							</div>
							{#if p.needsKey}
								<div class="key-status">
									<span class:status-ok={p.keyConfigured} class:status-missing={!p.keyConfigured}>
										{p.keyConfigured ? 'Key: ' + p.keyMasked : 'No key'}
									</span>
								</div>
							{:else}
								<div class="key-status"><span class="status-ok">No key needed</span></div>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<div class="section">
				<h2>Model</h2>
				<div class="form-row">
					<input type="text" bind:value={model} placeholder="Model name" class="input-field model-input" autocomplete="off" data-1p-ignore data-lpignore="true" />
					<span class="hint">Default: {currentProviderInfo?.defaultModel || '—'}</span>
				</div>
			</div>

			{#if currentProviderInfo?.needsKey}
				<div class="section">
					<h2>API Key</h2>
					{#if currentProviderInfo.keyConfigured}
						<div class="current-key">Current: <code>{currentProviderInfo.keyMasked}</code></div>
					{/if}
					<div class="form-row">
						<input
							type="password"
							bind:value={apiKeyInput}
							placeholder={currentProviderInfo.keyConfigured ? 'Enter new key to replace' : 'Enter API key'}
							class="input-field"
							autocomplete="new-password"
							data-1p-ignore
							data-lpignore="true"
						/>
					</div>
				</div>
			{/if}

			<div class="actions">
				<button class="btn btn-primary" onclick={save} disabled={saving}>
					{saving ? 'Saving...' : 'Save'}
				</button>
				<button class="btn btn-secondary" onclick={test} disabled={testing}>
					{testing ? 'Testing...' : 'Test Connection'}
				</button>
			</div>

			{#if message}
				<div class="message" class:message-ok={message.type === 'ok'} class:message-error={message.type === 'error'}>
					{message.text}
				</div>
			{/if}
			{#if testResult}
				<div class="message" class:message-ok={testResult.ok} class:message-error={!testResult.ok}>
					{#if testResult.ok}
						Connection OK — Model: {testResult.model}
					{:else}
						Connection failed: {testResult.error}
					{/if}
				</div>
			{/if}
		{/if}

	{:else}
		<!-- ═══════ Usage ═══════ -->
		<div class="section">
			<div class="period-selector">
				<div class="period-presets">
					{#each periodPresets as p}
						<button
							class="preset-btn"
							class:active={activePeriod === p.key}
							onclick={() => selectPeriod(p.key)}
						>{p.label}</button>
					{/each}
				</div>
				<div class="period-custom">
					<label>From</label>
					<input type="date" bind:value={customFrom} onchange={() => selectPeriod('custom')} />
					<label>To</label>
					<input type="date" bind:value={customTo} onchange={() => selectPeriod('custom')} />
				</div>
			</div>

			{#if usageLoading}
				<div class="loading">Loading usage data...</div>
			{:else if usageError}
				<div class="message message-error">{usageError}</div>
			{:else if usageData}
				{#if usageData.total_calls === 0}
					<div class="empty-state">No usage data for this period.</div>
				{:else}
					<!-- Totals -->
					<div class="usage-totals">
						<span>{usageData.total_calls} calls</span>
						<span>{formatTokens(usageData.total_input_tokens)} in</span>
						<span>{formatTokens(usageData.total_output_tokens)} out</span>
						<span class="total-tokens">{formatTokens(usageData.total_tokens)} total</span>
					</div>

					<!-- By Model -->
					<div class="subsection">
						<h3>By Model</h3>
						<table class="usage-table">
							<thead>
								<tr><th>Model</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
							</thead>
							<tbody>
								{#each Object.entries(usageData.by_model) as [name, stats]}
									<tr>
										<td class="mono">{name}</td>
										<td class="mono right">{stats.calls}</td>
										<td class="mono right">{formatTokens(stats.input_tokens)}</td>
										<td class="mono right">{formatTokens(stats.output_tokens)}</td>
										<td class="mono right">{formatTokens(stats.tokens)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- By Request Type -->
					<div class="subsection">
						<h3>By Request Type</h3>
						<table class="usage-table">
							<thead>
								<tr><th>Type</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
							</thead>
							<tbody>
								{#each Object.entries(usageData.by_type) as [type, stats]}
									<tr>
										<td>{type}</td>
										<td class="mono right">{stats.calls}</td>
										<td class="mono right">{formatTokens(stats.input_tokens)}</td>
										<td class="mono right">{formatTokens(stats.output_tokens)}</td>
										<td class="mono right">{formatTokens(stats.tokens)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- By Provider -->
					{#if Object.keys(usageData.by_provider).length > 0}
						<div class="subsection">
							<h3>By Provider</h3>
							<table class="usage-table">
								<thead>
									<tr><th>Provider</th><th>Calls</th><th>In</th><th>Out</th><th>Total</th></tr>
								</thead>
								<tbody>
									{#each Object.entries(usageData.by_provider) as [prov, stats]}
										<tr>
											<td>{prov}</td>
											<td class="mono right">{stats.calls}</td>
											<td class="mono right">{formatTokens(stats.input_tokens)}</td>
											<td class="mono right">{formatTokens(stats.output_tokens)}</td>
											<td class="mono right">{formatTokens(stats.tokens)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.settings-page {
		max-width: 900px;
		margin: 0 auto;
		padding: 2rem 1.5rem;
	}

	.settings-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}
	.settings-header h1 {
		font-size: 1.4rem;
		font-weight: 600;
		color: #e1e4e8;
	}
	.back-link {
		font-size: 0.85rem;
		color: #8b9cf7;
	}

	/* Tabs */
	.tabs {
		display: flex;
		gap: 2px;
		margin-bottom: 1.5rem;
		border-bottom: 1px solid rgba(255,255,255,0.1);
	}
	.tab {
		padding: 0.6rem 1.2rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: #888;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.tab:hover { color: #ccc; }
	.tab.active {
		color: #a5b4fc;
		border-bottom-color: #a5b4fc;
	}

	/* Sections */
	.section {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.08);
		border-radius: 8px;
		padding: 1.2rem;
		margin-bottom: 1rem;
	}
	.section h2 {
		font-size: 0.95rem;
		font-weight: 600;
		color: #ccc;
		margin-bottom: 0.8rem;
	}

	/* Provider grid */
	.provider-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.6rem;
	}
	.provider-card {
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 6px;
		padding: 0.8rem;
		cursor: pointer;
		text-align: left;
		color: #ccc;
		transition: border-color 0.15s;
	}
	.provider-card:hover { border-color: rgba(255,255,255,0.2); }
	.provider-card.selected {
		border-color: #a5b4fc;
		background: rgba(165,180,252,0.06);
	}
	.provider-name {
		font-weight: 600;
		font-size: 0.9rem;
		margin-bottom: 0.4rem;
	}
	.provider-meta {
		display: flex;
		gap: 0.5rem;
		font-size: 0.75rem;
		margin-bottom: 0.3rem;
	}
	.dsgvo-ok { color: #4caf50; }
	.dsgvo-warn { color: #ffb74d; }
	.provider-region { color: #888; }
	.key-status { font-size: 0.75rem; }
	.status-ok { color: #4caf50; }
	.status-missing { color: #ff6b6b; }

	/* Form */
	.form-row {
		display: flex;
		align-items: center;
		gap: 0.8rem;
	}
	.input-field {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		color: #e1e4e8;
		font-size: 0.85rem;
		font-family: 'JetBrains Mono', monospace;
		flex: 1;
		max-width: 400px;
	}
	.input-field:focus {
		outline: none;
		border-color: #a5b4fc;
	}
	.model-input { max-width: 500px; }
	.hint { font-size: 0.75rem; color: #666; }
	.current-key {
		font-size: 0.8rem;
		color: #888;
		margin-bottom: 0.5rem;
	}
	.current-key code {
		font-family: 'JetBrains Mono', monospace;
		color: #aaa;
	}

	/* Buttons */
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-bottom: 1rem;
	}
	.btn {
		padding: 0.5rem 1.2rem;
		border: 1px solid rgba(255,255,255,0.15);
		border-radius: 6px;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.btn:disabled { opacity: 0.5; cursor: default; }
	.btn-primary {
		background: #a5b4fc;
		color: #0f1117;
		border-color: #a5b4fc;
		font-weight: 600;
	}
	.btn-primary:hover:not(:disabled) { background: #8b9cf7; }
	.btn-secondary {
		background: rgba(255,255,255,0.05);
		color: #ccc;
	}
	.btn-secondary:hover:not(:disabled) { background: rgba(255,255,255,0.1); }

	/* Messages */
	.message {
		padding: 0.6rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		margin-bottom: 0.5rem;
	}
	.message-ok {
		background: rgba(76,175,80,0.1);
		border: 1px solid rgba(76,175,80,0.3);
		color: #4caf50;
	}
	.message-error {
		background: rgba(255,107,107,0.1);
		border: 1px solid rgba(255,107,107,0.3);
		color: #ff6b6b;
	}

	.loading, .empty-state {
		padding: 1.5rem;
		text-align: center;
		color: #666;
		font-size: 0.9rem;
	}

	/* ── Usage tab ── */
	.period-selector {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}
	.period-presets {
		display: flex;
		gap: 4px;
	}
	.preset-btn {
		padding: 0.35rem 0.8rem;
		background: rgba(255,255,255,0.03);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 4px;
		color: #888;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.preset-btn:hover { color: #ccc; border-color: rgba(255,255,255,0.25); }
	.preset-btn.active {
		background: rgba(165,180,252,0.1);
		border-color: #a5b4fc;
		color: #a5b4fc;
	}
	.period-custom {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.8rem;
		color: #888;
	}
	.period-custom input[type="date"] {
		background: rgba(255,255,255,0.05);
		border: 1px solid rgba(255,255,255,0.12);
		border-radius: 4px;
		color: #ccc;
		padding: 0.3rem 0.5rem;
		font-size: 0.8rem;
		font-family: 'JetBrains Mono', monospace;
	}

	.usage-totals {
		display: flex;
		gap: 1.5rem;
		font-size: 0.9rem;
		color: #aaa;
		margin-bottom: 1rem;
		font-family: 'JetBrains Mono', monospace;
	}
	.total-tokens {
		color: #a5b4fc;
		font-weight: 600;
	}

	.subsection {
		margin-top: 1.2rem;
	}
	.subsection h3 {
		font-size: 0.85rem;
		color: #888;
		font-weight: 500;
		margin-bottom: 0.5rem;
	}

	.usage-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}
	.usage-table th {
		text-align: left;
		padding: 0.5rem 0.75rem;
		color: #666;
		font-weight: 500;
		border-bottom: 1px solid rgba(255,255,255,0.08);
	}
	.usage-table td {
		padding: 0.5rem 0.75rem;
		color: #ccc;
		border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.mono { font-family: 'JetBrains Mono', monospace; }
	.right { text-align: right; }
</style>
