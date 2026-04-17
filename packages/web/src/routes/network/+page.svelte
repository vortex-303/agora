<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, connectionState, reactiveState } from '$lib/stores.svelte.js';
	import type { Profile } from '$lib/profiles.js';

	let nodes = $state<Profile[]>([]);
	let p2pPeers = $state(0);
	let swarmTopics = $state<string[]>([]);
	let refreshing = $state(false);

	onMount(() => {
		const check = setInterval(() => {
			const pm = appState.profileManager;
			const fm = appState.feedManager;
			if (pm && fm) {
				clearInterval(check);
				refresh();
				const poll = setInterval(refresh, 10_000);
				return () => clearInterval(poll);
			}
		}, 50);
		return () => clearInterval(check);
	});

	function refresh() {
		const pm = appState.profileManager;
		const fm = appState.feedManager;
		if (!pm || !fm) return;

		nodes = pm.getAllProfiles();
		p2pPeers = fm.swarmManager.getConnectedCount();
		swarmTopics = fm.swarmManager.getSwarmTopics();
	}

	async function manualRefresh() {
		refreshing = true;
		refresh();
		setTimeout(() => { refreshing = false; }, 500);
	}

	function toggleSeedMode() {
		appState.seedMode?.toggle();
	}

	let _tick = $derived(reactiveState.tick);
	let networkStats = $derived(appState.feedManager?.getNetworkStats());
	let seedEnabled = $derived((_tick, appState.seedMode?.isEnabled() || false));
	let seedStats = $derived((_tick, appState.seedMode?.getStats()));
	let seedBadge = $derived((_tick, appState.seedMode?.getBadge()));
	let seedUptime = $derived((_tick, appState.seedMode?.formatUptime() || '0m'));
</script>

<div class="network-page">
	<div class="header">
		<h2>Network</h2>
		<button class="refresh-btn" onclick={manualRefresh} class:spinning={refreshing}>&#x21BB;</button>
	</div>

	<!-- Seed Mode Card -->
	<div class="seed-card card" class:seed-active={seedEnabled}>
		<div class="seed-header">
			<div class="seed-info">
				<h3 class="seed-title">
					{#if seedEnabled}
						<span class="seed-dot"></span> Seed Mode Active
					{:else}
						Seed Mode
					{/if}
				</h3>
				<p class="seed-desc">
					{#if seedEnabled}
						You're hosting content for the network. Thank you.
					{:else}
						Help the network by caching and serving content for other users.
					{/if}
				</p>
			</div>
			<button class="seed-toggle" class:toggled={seedEnabled} onclick={toggleSeedMode}>
				<span class="toggle-knob"></span>
			</button>
		</div>

		{#if seedEnabled && seedStats}
			<div class="seed-stats">
				<div class="seed-stat">
					<span class="seed-val">{seedStats.storedAuthors}</span>
					<span class="seed-label">users hosted</span>
				</div>
				<div class="seed-stat">
					<span class="seed-val">{seedStats.objectsServed}</span>
					<span class="seed-label">served</span>
				</div>
				<div class="seed-stat">
					<span class="seed-val">{seedStats.peersHelped}</span>
					<span class="seed-label">peers helped</span>
				</div>
				<div class="seed-stat">
					<span class="seed-val">{seedUptime}</span>
					<span class="seed-label">uptime</span>
				</div>
			</div>
			{#if seedBadge}
				<div class="seed-badge-row">
					<span class="seed-badge">{seedBadge}</span>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Stats bar -->
	<div class="stats-bar">
		<div class="stat-pill">
			<span class="stat-dot" class:online={connectionState.status === 'connected'}></span>
			<span>{connectionState.status === 'connected' ? 'P2P active' : connectionState.status}</span>
		</div>
		<div class="stat-pill">
			<span class="stat-val">{p2pPeers}</span> peers
		</div>
		<div class="stat-pill">
			<span class="stat-val">{swarmTopics.length}</span> swarms
		</div>
		{#if networkStats}
			<div class="stat-pill">
				<span class="stat-val">{networkStats.cachedObjects}</span> cached
			</div>
			{#if networkStats.objectsServed > 0}
				<div class="stat-pill">
					<span class="stat-val">{networkStats.objectsServed}</span> served
				</div>
			{/if}
		{/if}
	</div>

	<!-- Swarms -->
	{#if swarmTopics.length > 0}
		<h3 class="section-label">Active swarms</h3>
		<div class="swarm-list">
			{#each swarmTopics as topic (topic)}
				<div class="swarm-item card">
					<code class="mono">{topic.length > 50 ? topic.slice(0, 50) + '...' : topic}</code>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Known nodes -->
	{#if nodes.length > 0}
		<h3 class="section-label">Known peers &mdash; {nodes.length}</h3>
		<div class="node-list">
			{#each nodes as node (node.publicKey)}
				<div class="node-card card">
					<div class="node-left">
						<div class="node-avatar">{node.publicKey.slice(0, 2)}</div>
						<div class="node-info">
							<span class="node-name">{node.name || node.publicKey.slice(0, 12) + '...'}</span>
						</div>
					</div>
					<div class="node-actions">
						<a href="/p/{encodeURIComponent(node.publicKey)}" class="node-btn">Lobby</a>
						<a href="/dm/{encodeURIComponent(node.publicKey)}" class="node-btn primary">Message</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if nodes.length === 0 && p2pPeers === 0}
		<div class="empty">
			<p>No peers discovered yet.</p>
			<p class="sub">Open in another tab or share your lobby link to connect with someone.</p>
		</div>
	{/if}

	<!-- Network contribution -->
	{#if networkStats}
		<div class="contribution card">
			<h3 class="section-label">Your contribution</h3>
			<div class="contrib-stats">
				<div class="contrib-item">
					<span class="contrib-val">{networkStats.cachedObjects}</span>
					<span class="contrib-label">objects cached</span>
				</div>
				<div class="contrib-item">
					<span class="contrib-val">{networkStats.connectedPeers}</span>
					<span class="contrib-label">peers connected</span>
				</div>
				<div class="contrib-item">
					<span class="contrib-val">{networkStats.objectsServed}</span>
					<span class="contrib-label">objects served</span>
				</div>
				<div class="contrib-item">
					<span class="contrib-val">{networkStats.objectsReceived}</span>
					<span class="contrib-label">received from peers</span>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.network-page { max-width: 600px; margin: 0 auto; }
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
	h2 { color: var(--text-primary); margin: 0; font-size: 1.3rem; }
	.refresh-btn {
		background: none; border: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary);
		width: 32px; height: 32px; border-radius: 8px; font-size: 1rem; cursor: pointer;
		transition: all 0.2s;
	}
	.refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
	.refresh-btn.spinning { animation: spin 0.5s ease; }
	@keyframes spin { to { transform: rotate(360deg); } }

	/* Seed Mode */
	.seed-card { padding: 20px; margin-bottom: 16px; transition: all 0.3s; }
	.seed-card.seed-active { border-color: rgba(74,222,128,0.2); background: rgba(74,222,128,0.03); }
	.seed-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
	.seed-info { flex: 1; }
	.seed-title { font-size: 0.9rem; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; display: flex; align-items: center; gap: 8px; }
	.seed-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; animation: pulse-dot 2s infinite; }
	.seed-desc { font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; }

	.seed-toggle {
		width: 44px; height: 24px; border-radius: 12px; border: none; cursor: pointer;
		background: var(--bg-input); position: relative; transition: background 0.2s; flex-shrink: 0;
	}
	.seed-toggle.toggled { background: #4ade80; }
	.toggle-knob {
		display: block; width: 18px; height: 18px; border-radius: 50%;
		background: white; position: absolute; top: 3px; left: 3px;
		transition: transform 0.2s;
	}
	.seed-toggle.toggled .toggle-knob { transform: translateX(20px); }

	.seed-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
	.seed-stat { text-align: center; }
	.seed-val { display: block; font-size: 1.1rem; font-weight: 700; color: #4ade80; font-family: var(--font-mono); }
	.seed-label { font-size: 0.6rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.03em; }
	.seed-badge-row { margin-top: 12px; }
	.seed-badge {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;
		background: rgba(74,222,128,0.1); border: 1px solid rgba(74,222,128,0.2); color: #4ade80;
	}

	.stats-bar {
		display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px;
	}
	.stat-pill {
		display: flex; align-items: center; gap: 5px;
		padding: 4px 12px; border-radius: 20px; font-size: 0.75rem;
		background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.04);
		color: var(--text-secondary);
	}
	.stat-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); }
	.stat-dot.online { background: #4ade80; animation: pulse-dot 2s infinite; }
	.stat-val { color: var(--accent); font-weight: 600; font-family: var(--font-mono); }

	.section-label {
		display: flex; align-items: center; gap: 6px;
		color: var(--text-secondary); font-size: 0.75rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.06em; margin: 20px 0 10px;
	}

	.swarm-list { display: flex; flex-direction: column; gap: 4px; }
	.swarm-item { padding: 8px 12px; font-size: 0.75rem; }

	.node-list { display: flex; flex-direction: column; gap: 6px; }
	.node-card {
		display: flex; justify-content: space-between; align-items: center;
		padding: 12px 14px; transition: all 0.2s;
	}
	.node-card:hover { border-color: var(--accent-border); }
	.node-left { display: flex; align-items: center; gap: 10px; }
	.node-avatar {
		width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.node-info { display: flex; flex-direction: column; gap: 1px; }
	.node-name { font-size: 0.85rem; color: var(--text-primary); }
	.node-actions { display: flex; gap: 6px; }
	.node-btn {
		padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 500;
		text-decoration: none; color: var(--text-secondary);
		background: var(--bg-input); border: 1px solid rgba(255,255,255,0.04);
		transition: all 0.15s;
	}
	.node-btn:hover { border-color: var(--accent-border); color: var(--accent); }
	.node-btn.primary { background: rgba(249,115,22,0.1); color: var(--accent); border-color: var(--accent-border); }

	.empty { text-align: center; margin: 64px 0; color: var(--text-tertiary); }
	.empty .sub { font-size: 0.85rem; }

	.contribution { padding: 16px; margin-top: 24px; }
	.contribution .section-label { margin: 0 0 12px; }
	.contrib-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
	.contrib-item { text-align: center; }
	.contrib-val { display: block; font-size: 1.1rem; font-weight: 700; color: var(--accent); font-family: var(--font-mono); }
	.contrib-label { font-size: 0.6rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.03em; }

	@media (max-width: 640px) {
		.contrib-stats { grid-template-columns: repeat(2, 1fr); }
		.seed-stats { grid-template-columns: repeat(2, 1fr); }
		.node-actions { flex-direction: column; gap: 4px; }
	}
</style>
