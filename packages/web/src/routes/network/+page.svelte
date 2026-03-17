<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, connectionState } from '$lib/stores.svelte.js';
	import type { Profile } from '$lib/profiles.js';

	let nodes = $state<Profile[]>([]);
	let p2pPeers = $state(0);
	let relayLatency = $state<number | null>(null);
	let refreshing = $state(false);

	onMount(() => {
		const check = setInterval(() => {
			const pm = appState.profileManager;
			const fm = appState.feedManager;
			if (pm && fm) {
				clearInterval(check);
				refresh();
				// Auto-refresh every 10s
				const poll = setInterval(refresh, 10_000);
				return () => clearInterval(poll);
			}
		}, 50);
		return () => clearInterval(check);
	});

	async function refresh() {
		const pm = appState.profileManager;
		const fm = appState.feedManager;
		if (!pm || !fm) return;

		fm.relay.requestPeers();
		nodes = pm.getAllProfiles();
		p2pPeers = fm.peerManager.getConnectedCount();

		// Measure relay latency
		try {
			const start = Date.now();
			const res = await fetch('https://agora-relay.fly.dev/health', { signal: AbortSignal.timeout(5000) });
			if (res.ok) relayLatency = Date.now() - start;
		} catch { relayLatency = null; }
	}

	async function manualRefresh() {
		refreshing = true;
		await refresh();
		setTimeout(() => { refreshing = false; }, 500);
	}

	let onlineNodes = $derived(nodes.filter(n => n.online));
	let offlineNodes = $derived(nodes.filter(n => !n.online));

	let networkStats = $derived(appState.feedManager?.getNetworkStats());
</script>

<div class="network-page">
	<div class="header">
		<h2>Network</h2>
		<button class="refresh-btn" onclick={manualRefresh} class:spinning={refreshing}>↻</button>
	</div>

	<!-- Stats bar -->
	<div class="stats-bar">
		<div class="stat-pill">
			<span class="stat-dot" class:online={connectionState.status === 'connected'}></span>
			<span>Relay {relayLatency ? `${relayLatency}ms` : connectionState.status}</span>
		</div>
		<div class="stat-pill">
			<span class="stat-val">{p2pPeers}</span> P2P peers
		</div>
		<div class="stat-pill">
			<span class="stat-val">{onlineNodes.length}</span> online
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

	<!-- Online nodes -->
	{#if onlineNodes.length > 0}
		<h3 class="section-label">
			<span class="live-dot"></span>
			Online — {onlineNodes.length}
		</h3>
		<div class="node-list">
			{#each onlineNodes as node (node.publicKey)}
				<div class="node-card card">
					<div class="node-left">
						<div class="node-avatar">{node.publicKey.slice(0, 2)}</div>
						<div class="node-info">
							<span class="node-name">{node.name || node.publicKey.slice(0, 12) + '...'}</span>
							{#if node.city || node.country}
								<span class="node-location">{[node.city, node.country].filter(Boolean).join(', ')}</span>
							{/if}
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

	<!-- Offline/known nodes -->
	{#if offlineNodes.length > 0}
		<h3 class="section-label">Known — {offlineNodes.length}</h3>
		<div class="node-list">
			{#each offlineNodes as node (node.publicKey)}
				<div class="node-card card offline">
					<div class="node-left">
						<div class="node-avatar off">{node.publicKey.slice(0, 2)}</div>
						<div class="node-info">
							<span class="node-name">{node.name || node.publicKey.slice(0, 12) + '...'}</span>
							{#if node.city || node.country}
								<span class="node-location">{[node.city, node.country].filter(Boolean).join(', ')}</span>
							{/if}
						</div>
					</div>
					<div class="node-actions">
						<a href="/p/{encodeURIComponent(node.publicKey)}" class="node-btn">Lobby</a>
						<a href="/dm/{encodeURIComponent(node.publicKey)}" class="node-btn">Message</a>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if nodes.length === 0}
		<div class="empty">
			<p>No nodes discovered yet.</p>
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
	.live-dot {
		width: 6px; height: 6px; border-radius: 50%; background: #4ade80;
		animation: pulse-dot 2s infinite;
	}

	.node-list { display: flex; flex-direction: column; gap: 6px; }
	.node-card {
		display: flex; justify-content: space-between; align-items: center;
		padding: 12px 14px; transition: all 0.2s;
	}
	.node-card:hover { border-color: var(--accent-border); }
	.node-card.offline { opacity: 0.5; }
	.node-left { display: flex; align-items: center; gap: 10px; }
	.node-avatar {
		width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.node-avatar.off { opacity: 0.4; border-color: rgba(255,255,255,0.06); color: var(--text-tertiary); }
	.node-info { display: flex; flex-direction: column; gap: 1px; }
	.node-name { font-size: 0.85rem; color: var(--text-primary); }
	.node-location { font-size: 0.7rem; color: var(--text-tertiary); }
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
		.node-actions { flex-direction: column; gap: 4px; }
	}
</style>
