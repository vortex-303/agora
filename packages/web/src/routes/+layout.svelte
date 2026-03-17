<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { loadIdentity } from '$lib/identity.js';
	import { identityState, connectionState, appState, triggerReactive } from '$lib/stores.svelte.js';
	import { RelayPool, DEFAULT_RELAYS } from '$lib/relay-pool.js';
	import { FeedManager } from '$lib/feed.js';
	import { ProfileManager } from '$lib/profiles.js';
	import { DMManager } from '$lib/dm.js';
	import { VoteManager } from '$lib/votes.js';
	import { ClientModeration } from '$lib/moderation-client.js';
	import { CommunityManager } from '$lib/communities.js';
	import GridCanvas from '$lib/GridCanvas.svelte';
	import '$lib/theme.css';

	let { children } = $props();
	let showUserMenu = $state(false);
	let copied = $state(false);

	function getRelayUrls(): string[] {
		if (typeof window === 'undefined') return DEFAULT_RELAYS;
		const stored = localStorage.getItem('agora_relays');
		if (stored) { try { return JSON.parse(stored); } catch {} }
		if (window.location.hostname === 'localhost') return ['ws://localhost:9800', ...DEFAULT_RELAYS];
		return [...DEFAULT_RELAYS];
	}

	onMount(async () => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch(() => {});
		}

		const identity = await loadIdentity();
		if (!identity) {
			if (!window.location.pathname.startsWith('/setup') && !window.location.pathname.startsWith('/p/')) goto('/setup');
			return;
		}
		identityState.identity = identity;

		const pool = new RelayPool(getRelayUrls(), identity);
		const fm = new FeedManager(pool, identity);
		fm.onStatusChange((status) => { connectionState.status = status; });
		await fm.init();
		pool.connect();
		appState.feedManager = fm;

		const pm = new ProfileManager(fm, identity);
		await pm.init();
		appState.profileManager = pm;
		pool.onPeers((peers) => { pm.setOnline(peers); });

		const dm = new DMManager(fm, identity);
		await dm.init();
		appState.dmManager = dm;

		// Keep these initialized but hidden from UI
		const vm = new VoteManager(fm, identity);
		await vm.init();
		vm.onChange(triggerReactive);
		appState.voteManager = vm;

		const mod = new ClientModeration(fm, identity);
		await mod.init();
		mod.onChange(triggerReactive);
		appState.moderation = mod;

		const cm = new CommunityManager(fm, identity);
		await cm.init();
		appState.communityManager = cm;
	});

	function copyAddress() {
		if (!identityState.identity) return;
		navigator.clipboard.writeText(identityState.identity.publicKeyBase64);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	function handleClickOutside() {
		showUserMenu = false;
	}

	let unreadDMs = $state(0);
	$effect(() => {
		const dm = appState.dmManager;
		if (dm) {
			const update = () => { unreadDMs = dm.getConversationList().length; };
			dm.onChange(update);
			update();
		}
	});

	let statusClass = $derived(
		connectionState.status === 'connected' ? 'badge-connected' :
		connectionState.status === 'connecting' || connectionState.status === 'authenticating' ? 'badge-connecting' :
		'badge-disconnected'
	);

	let isLobbyOrSetup = $derived(
		$page.url.pathname === '/' || $page.url.pathname.startsWith('/setup') || $page.url.pathname.startsWith('/p/')
	);
</script>

<svelte:head>
	<title>Riot</title>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="manifest" href="/manifest.json" />
	<meta name="theme-color" content="#f97316" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Riot" />
	<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="grid-bg"></div>
<div class="glow glow-1"></div>
<div class="glow glow-2"></div>
<GridCanvas />

<div class="app" onclick={handleClickOutside}>
	<nav>
		<a href="/" class="logo">riot<span class="logo-dot">.</span></a>
		{#if identityState.identity}
			<div class="nav-right">
				<a href="/dm" class="dm-btn" class:active={$page.url.pathname.startsWith('/dm')}>
					Messages
					{#if unreadDMs > 0}
						<span class="nav-badge">{unreadDMs}</span>
					{/if}
				</a>
				<span class="badge {statusClass}">
					<span class="dot"></span>
					<span class="status-text">{connectionState.status === 'connected' ? 'live' : connectionState.status}</span>
				</span>
				<button class="user-btn" onclick={(e) => { e.stopPropagation(); showUserMenu = !showUserMenu; }}>
					<span class="mono">{identityState.identity.publicKeyBase64.slice(0, 8)}</span>
					<span class="caret">▾</span>
				</button>
				{#if showUserMenu}
					<div class="user-menu card" onclick={(e) => e.stopPropagation()}>
						<a href="/p/{encodeURIComponent(identityState.identity.publicKeyBase64)}" class="menu-link" onclick={() => { showUserMenu = false; }}>My Lobby</a>
						<a href="/settings" class="menu-link" onclick={() => { showUserMenu = false; }}>Settings</a>
						<div class="menu-divider"></div>
						<div class="menu-label">Public address</div>
						<code class="menu-address mono">{identityState.identity.publicKeyBase64}</code>
						<button class="btn" onclick={copyAddress} style="width:100%">
							{copied ? 'Copied!' : 'Copy Address'}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.app { position: relative; z-index: 1; max-width: 700px; margin: 0 auto; padding: 0 16px; }
	nav {
		display: flex; justify-content: space-between; align-items: center;
		padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.04); margin-bottom: 20px;
	}
	.logo { font-size: 1.3em; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; }
	.logo:hover { color: var(--text-primary); }
	.logo-dot { color: var(--accent); }
	.nav-right { display: flex; align-items: center; gap: 10px; position: relative; }
	.dm-btn {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 14px; border-radius: 8px; font-size: 0.82rem; font-weight: 500;
		color: var(--text-secondary); text-decoration: none; transition: all 0.2s;
	}
	.dm-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.03); }
	.dm-btn.active { color: var(--accent); background: rgba(249,115,22,0.08); }
	.nav-badge {
		background: var(--accent); color: #000; font-size: 0.6rem; font-weight: 700;
		min-width: 16px; height: 16px; border-radius: 8px;
		display: flex; align-items: center; justify-content: center; padding: 0 4px;
	}
	.dot {
		display: inline-block; width: 6px; height: 6px; border-radius: 50%;
		background: currentColor; animation: pulse-dot 2s infinite;
	}
	.user-btn {
		display: flex; align-items: center; gap: 4px;
		background: var(--bg-surface); border: 1px solid rgba(255,255,255,0.04);
		border-radius: 6px; padding: 5px 10px; color: var(--text-secondary);
		font-size: 0.75rem; cursor: pointer; transition: all 0.2s;
	}
	.user-btn:hover { border-color: var(--accent-border); color: var(--text-primary); }
	.caret { font-size: 0.6rem; }
	.user-menu {
		position: absolute; top: 100%; right: 0; margin-top: 8px;
		width: 300px; padding: 8px; z-index: 100;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.08);
	}
	.menu-link {
		display: block; padding: 10px 12px; border-radius: 6px;
		color: var(--text-primary); font-size: 0.85rem; font-weight: 500;
		text-decoration: none; transition: all 0.15s;
	}
	.menu-link:hover { background: rgba(255,255,255,0.04); color: var(--accent); }
	.menu-divider { height: 1px; background: rgba(255,255,255,0.04); margin: 6px 0; }
	.menu-label { color: var(--text-tertiary); font-size: 0.7rem; padding: 4px 12px; }
	.menu-address {
		display: block; font-size: 0.6rem; color: var(--accent);
		word-break: break-all; margin: 4px 12px 8px; padding: 6px 8px;
		background: var(--bg-input); border-radius: 4px;
	}
	main { min-height: 70vh; }

	@media (max-width: 640px) {
		.app { padding: 0 10px; }
		nav { padding: 10px 0; margin-bottom: 12px; }
		.status-text { display: none; }
		.user-btn .mono { display: none; }
		.user-btn .caret { display: none; }
		.user-btn::before { content: '⚙'; font-size: 0.9rem; }
		.user-menu { width: calc(100vw - 20px); right: -10px; }
	}
</style>
