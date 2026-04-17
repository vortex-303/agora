<script lang="ts">
	import { onMount } from 'svelte';
	import { feedState, appState } from '$lib/stores.svelte.js';
	import type { PostContent } from '@agora/core';

	interface RelayHealth {
		url: string;
		name: string;
		region: string;
		status: 'online' | 'offline' | 'checking';
		objects: number;
		clients: number;
		authenticated: number;
		countries: number;
		syncPeers: number;
		uptime: number;
		latency: number;
	}

	const RELAYS = [
		{ url: 'https://agora-relay.fly.dev', name: 'US West', region: 'San Jose, CA' },
		{ url: 'https://agora-relay-eu.fly.dev', name: 'EU West', region: 'Amsterdam, NL' },
	];

	let relays = $state<RelayHealth[]>(RELAYS.map(r => ({
		...r, status: 'checking' as const, objects: 0, clients: 0,
		authenticated: 0, countries: 0, syncPeers: 0, uptime: 0, latency: 0,
	})));
	let lastRefresh = $state(Date.now());
	let totalObjects = $state(0);
	let totalUsers = $state(0);
	let totalCountries = $state(0);
	let synced = $state(false);

	async function fetchRelayHealth(index: number) {
		const relay = relays[index];
		const start = Date.now();
		try {
			const res = await fetch(`${relay.url}/health`, { signal: AbortSignal.timeout(5000) });
			const data = await res.json();
			const latency = Date.now() - start;
			relays[index] = {
				...relay,
				status: 'online',
				objects: data.objects || 0,
				clients: data.clients || 0,
				authenticated: data.authenticated || 0,
				countries: data.countries || 0,
				syncPeers: data.syncPeers || 0,
				uptime: data.uptime || 0,
				latency,
			};
		} catch {
			relays[index] = { ...relay, status: 'offline', latency: 0 };
		}
	}

	async function refreshAll() {
		await Promise.all(RELAYS.map((_, i) => fetchRelayHealth(i)));
		const online = relays.filter(r => r.status === 'online');
		totalObjects = Math.max(...online.map(r => r.objects), 0);
		totalUsers = online.reduce((sum, r) => sum + r.authenticated, 0);
		totalCountries = Math.max(...online.map(r => r.countries), 0);
		synced = online.length > 1 && Math.abs(online[0].objects - online[1].objects) < 5;
		lastRefresh = Date.now();
	}

	onMount(() => {
		refreshAll();
		const interval = setInterval(refreshAll, 15000);
		return () => clearInterval(interval);
	});

	function formatUptime(s: number): string {
		if (s < 60) return `${s}s`;
		if (s < 3600) return `${Math.floor(s / 60)}m`;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}h ${m}m`;
	}

	// Community stats from local feed
	let communityStats = $derived(() => {
		const stats = new Map<string, { posts: number; authors: Set<string> }>();
		for (const obj of feedState.objects) {
			if (obj.body.type !== 'post') continue;
			const topic = (obj.body.content as PostContent).topic;
			if (!topic) continue;
			if (!stats.has(topic)) stats.set(topic, { posts: 0, authors: new Set() });
			const s = stats.get(topic)!;
			s.posts++;
			s.authors.add(obj.body.author);
		}
		return [...stats.entries()]
			.map(([name, s]) => ({ name, posts: s.posts, members: s.authors.size }))
			.sort((a, b) => b.posts - a.posts);
	});

	let p2pPeers = $derived(appState.feedManager?.swarmManager.getConnectedCount() || 0);
	let networkStats = $derived(appState.feedManager?.getNetworkStats());
</script>

<div class="status-page">
	<div class="header">
		<h2>Network Status</h2>
		<span class="refresh-time">Updated {Math.floor((Date.now() - lastRefresh) / 1000)}s ago · auto-refreshes</span>
	</div>

	<!-- Big stats -->
	<div class="big-stats">
		<div class="big-stat">
			<div class="big-val">{totalObjects.toLocaleString()}</div>
			<div class="big-label">Objects</div>
		</div>
		<div class="big-stat">
			<div class="big-val">{totalUsers}</div>
			<div class="big-label">Connected Users</div>
		</div>
		<div class="big-stat">
			<div class="big-val">{totalCountries}</div>
			<div class="big-label">Countries</div>
		</div>
		<div class="big-stat">
			<div class="big-val">{relays.filter(r => r.status === 'online').length}/{relays.length}</div>
			<div class="big-label">Relays Online</div>
		</div>
	</div>

	<!-- Sync status -->
	{#if relays.filter(r => r.status === 'online').length > 1}
		<div class="sync-bar" class:synced>
			{#if synced}
				<span class="sync-dot green"></span> Relays in sync
			{:else}
				<span class="sync-dot yellow"></span> Relays syncing...
			{/if}
		</div>
	{/if}

	<!-- Relay cards -->
	<h3 class="section-title">Relays</h3>
	<div class="relay-grid">
		{#each relays as relay (relay.url)}
			<div class="relay-card card">
				<div class="relay-header">
					<div class="relay-name">{relay.name}</div>
					<span class="relay-status" class:online={relay.status === 'online'} class:offline={relay.status === 'offline'}>
						{relay.status}
					</span>
				</div>
				<div class="relay-region">{relay.region}</div>
				{#if relay.status === 'online'}
					<div class="relay-stats">
						<div class="relay-row">
							<span class="rl">Objects</span>
							<span class="rv">{relay.objects.toLocaleString()}</span>
						</div>
						<div class="relay-row">
							<span class="rl">Users</span>
							<span class="rv">{relay.authenticated}</span>
						</div>
						<div class="relay-row">
							<span class="rl">Countries</span>
							<span class="rv">{relay.countries}</span>
						</div>
						<div class="relay-row">
							<span class="rl">Sync Peers</span>
							<span class="rv">{relay.syncPeers}</span>
						</div>
						<div class="relay-row">
							<span class="rl">Latency</span>
							<span class="rv">{relay.latency}ms</span>
						</div>
						<div class="relay-row">
							<span class="rl">Uptime</span>
							<span class="rv">{formatUptime(relay.uptime)}</span>
						</div>
					</div>
				{/if}
				<div class="relay-url mono">{relay.url.replace('https://', '')}</div>
			</div>
		{/each}
	</div>

	<!-- P2P -->
	<h3 class="section-title">Peer-to-Peer</h3>
	<div class="p2p-card card">
		<div class="p2p-stats">
			<div class="p2p-stat">
				<span class="pv">{p2pPeers}</span>
				<span class="pl">WebRTC Peers</span>
			</div>
			{#if networkStats}
				<div class="p2p-stat">
					<span class="pv">{networkStats.cachedObjects}</span>
					<span class="pl">Cached Objects</span>
				</div>
				<div class="p2p-stat">
					<span class="pv">{networkStats.objectsServed}</span>
					<span class="pl">Served to Peers</span>
				</div>
				<div class="p2p-stat">
					<span class="pv">{networkStats.objectsReceived}</span>
					<span class="pl">Received from Peers</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Communities -->
	{#if communityStats().length > 0}
		<h3 class="section-title">Communities</h3>
		<div class="community-table card">
			<div class="ct-header">
				<span>Community</span>
				<span>Posts</span>
				<span>Members</span>
			</div>
			{#each communityStats() as c (c.name)}
				<div class="ct-row">
					<a href="/c/{c.name}" class="ct-name">#{c.name}</a>
					<span class="ct-val">{c.posts}</span>
					<span class="ct-val">{c.members}</span>
				</div>
			{/each}
		</div>
	{/if}

	<div class="footer-info">
		<p>This page auto-refreshes every 15 seconds. All data is public relay health information.</p>
		<p><a href="https://agorap2p.com">agorap2p.com</a> · <a href="https://github.com/vortex-303/agora">GitHub</a></p>
	</div>
</div>

<style>
	.status-page { max-width: 700px; margin: 0 auto; }
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
	h2 { color: var(--text-primary); margin: 0; font-size: 1.3rem; }
	.refresh-time { font-size: 0.7rem; color: var(--text-tertiary); }
	h3.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em; margin: 28px 0 12px;
	}

	.big-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
	.big-stat {
		background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.04);
		border-radius: 12px; padding: 16px; text-align: center;
	}
	.big-val { font-size: 1.6rem; font-weight: 700; color: var(--accent); font-family: var(--font-mono); }
	.big-label { font-size: 0.65rem; color: var(--text-tertiary); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

	.sync-bar {
		display: flex; align-items: center; gap: 8px; justify-content: center;
		padding: 8px; border-radius: 8px; font-size: 0.8rem;
		background: rgba(251,191,36,0.06); color: #fbbf24; margin-bottom: 8px;
	}
	.sync-bar.synced { background: rgba(74,222,128,0.06); color: #4ade80; }
	.sync-dot { width: 6px; height: 6px; border-radius: 50%; }
	.sync-dot.green { background: #4ade80; }
	.sync-dot.yellow { background: #fbbf24; animation: pulse-dot 2s infinite; }

	.relay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	.relay-card { padding: 16px; }
	.relay-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
	.relay-name { font-weight: 600; font-size: 0.95rem; }
	.relay-status {
		font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 10px;
		background: rgba(255,255,255,0.05); color: var(--text-tertiary);
	}
	.relay-status.online { background: rgba(74,222,128,0.1); color: #4ade80; }
	.relay-status.offline { background: rgba(239,68,68,0.1); color: #f87171; }
	.relay-region { font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 12px; }
	.relay-stats { margin-bottom: 10px; }
	.relay-row {
		display: flex; justify-content: space-between; padding: 4px 0;
		font-size: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.relay-row:last-child { border-bottom: none; }
	.rl { color: var(--text-tertiary); }
	.rv { color: var(--text-primary); font-family: var(--font-mono); font-size: 0.8rem; }
	.relay-url { font-size: 0.65rem; color: var(--text-tertiary); margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.03); }

	.p2p-card { padding: 16px; }
	.p2p-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
	.p2p-stat { text-align: center; }
	.pv { display: block; font-size: 1.2rem; font-weight: 700; color: var(--accent); font-family: var(--font-mono); }
	.pl { font-size: 0.65rem; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.03em; }

	.community-table { padding: 0; overflow: hidden; }
	.ct-header {
		display: grid; grid-template-columns: 1fr 80px 80px;
		padding: 10px 16px; font-size: 0.7rem; font-weight: 600; color: var(--text-tertiary);
		text-transform: uppercase; letter-spacing: 0.05em;
		border-bottom: 1px solid rgba(255,255,255,0.04);
	}
	.ct-row {
		display: grid; grid-template-columns: 1fr 80px 80px;
		padding: 8px 16px; font-size: 0.85rem;
		border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.ct-row:last-child { border-bottom: none; }
	.ct-name { color: var(--accent); font-weight: 500; }
	.ct-val { color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.8rem; text-align: center; }

	.footer-info { margin-top: 32px; text-align: center; font-size: 0.75rem; color: var(--text-tertiary); line-height: 1.8; }

	@media (max-width: 640px) {
		.big-stats { grid-template-columns: repeat(2, 1fr); }
		.relay-grid { grid-template-columns: 1fr; }
		.p2p-stats { grid-template-columns: repeat(2, 1fr); }
	}
</style>
