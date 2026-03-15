<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { loadIdentity } from '$lib/identity.js';
	import { identityState, connectionState, appState } from '$lib/stores.svelte.js';
	import { RelayPool, DEFAULT_RELAYS } from '$lib/relay-pool.js';
	import { FeedManager } from '$lib/feed.js';
	import { ProfileManager } from '$lib/profiles.js';
	import { DMManager } from '$lib/dm.js';
	import { CommunityManager } from '$lib/communities.js';
	import { VoteManager } from '$lib/votes.js';
	import { ClientModeration } from '$lib/moderation-client.js';
	import GridCanvas from '$lib/GridCanvas.svelte';
	import '$lib/theme.css';

	let { children } = $props();
	let showUserMenu = $state(false);
	let showNavMenu = $state(false);
	let copied = $state(false);

	const NAV_ITEMS = [
		{ href: '/', label: 'Feed', icon: '◆', match: (p: string) => p === '/' || p.startsWith('/post') },
		{ href: '/communities', label: 'Communities', icon: '⬡', match: (p: string) => p === '/communities' || p.startsWith('/c/') },
		{ href: '/network', label: 'Network', icon: '◎', match: (p: string) => p === '/network' },
		{ href: '/search', label: 'Search', icon: '⌕', match: (p: string) => p === '/search' },
		{ href: '/dm', label: 'Messages', icon: '◈', match: (p: string) => p.startsWith('/dm') },
	];

	function getRelayUrls(): string[] {
		if (typeof window === 'undefined') return DEFAULT_RELAYS;
		const stored = localStorage.getItem('agora_relays');
		if (stored) {
			try { return JSON.parse(stored); } catch {}
		}
		if (window.location.hostname === 'localhost') {
			return ['ws://localhost:9800', ...DEFAULT_RELAYS];
		}
		return [...DEFAULT_RELAYS];
	}

	onMount(async () => {
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('/sw.js').catch(() => {});
		}

		const identity = await loadIdentity();
		if (!identity) {
			if (!window.location.pathname.startsWith('/setup')) goto('/setup');
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

		const cm = new CommunityManager(fm, identity);
		await cm.init();
		appState.communityManager = cm;

		const vm = new VoteManager(fm, identity);
		await vm.init();
		appState.voteManager = vm;

		const mod = new ClientModeration(fm, identity);
		await mod.init();
		appState.moderation = mod;
	});

	function copyAddress() {
		if (!identityState.identity) return;
		navigator.clipboard.writeText(identityState.identity.publicKeyBase64);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	function handleClickOutside() {
		showUserMenu = false;
		showNavMenu = false;
	}

	function navigateTo(href: string) {
		showNavMenu = false;
		goto(href);
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
</script>

<svelte:head>
	<title>Agora</title>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="manifest" href="/manifest.json" />
	<meta name="theme-color" content="#f97316" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Agora" />
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
		<a href="/" class="logo">agora<span class="logo-dot">.</span></a>
		{#if identityState.identity}
			{@const path = $page.url.pathname}
			{@const activePage = NAV_ITEMS.find(n => n.match(path)) || NAV_ITEMS[0]}

			<!-- Desktop nav -->
			<div class="nav-desktop">
				{#each NAV_ITEMS as item (item.href)}
					<a href={item.href} class="nav-item" class:active={item.match(path)}>
						<span class="nav-icon">{item.icon}</span>
						<span class="nav-label">{item.label}</span>
						{#if item.href === '/dm' && unreadDMs > 0}
							<span class="nav-badge">{unreadDMs}</span>
						{/if}
					</a>
				{/each}
			</div>

			<!-- Mobile nav dropdown -->
			<div class="nav-mobile">
				<button class="nav-current" onclick={(e) => { e.stopPropagation(); showNavMenu = !showNavMenu; }}>
					<span class="nav-current-icon">{activePage.icon}</span>
					<span class="nav-current-label">{activePage.label}</span>
					{#if unreadDMs > 0 && activePage.href !== '/dm'}
						<span class="nav-badge">{unreadDMs}</span>
					{/if}
					<span class="nav-chevron" class:open={showNavMenu}>▾</span>
				</button>
				{#if showNavMenu}
					<div class="nav-dropdown" onclick={(e) => e.stopPropagation()}>
						{#each NAV_ITEMS as item (item.href)}
							<button class="nav-drop-item" class:active={item.match(path)}
								onclick={() => navigateTo(item.href)}>
								<span class="nav-drop-icon">{item.icon}</span>
								<span>{item.label}</span>
								{#if item.href === '/dm' && unreadDMs > 0}
									<span class="nav-badge">{unreadDMs}</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="nav-right">
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
						<div class="menu-label">Your public address</div>
						<code class="menu-address mono">{identityState.identity.publicKeyBase64}</code>
						<button class="btn" onclick={copyAddress} style="width:100%">
							{copied ? 'Copied!' : 'Copy Address'}
						</button>
						<a href="/settings" class="menu-link" onclick={() => { showUserMenu = false; }}>Settings</a>
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
	.app {
		position: relative; z-index: 1;
		max-width: 900px; margin: 0 auto; padding: 0 16px;
	}
	nav {
		display: flex; justify-content: space-between; align-items: center;
		padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
		margin-bottom: 20px;
	}
	.logo {
		font-size: 1.3em; font-weight: 700; color: var(--text-primary);
		letter-spacing: -0.02em;
	}
	.logo:hover { color: var(--text-primary); }
	.logo-dot { color: var(--accent); }

	/* Desktop nav */
	.nav-desktop { display: flex; gap: 4px; }
	.nav-item {
		display: flex; align-items: center; gap: 6px;
		padding: 7px 14px; border-radius: 8px;
		color: var(--text-tertiary); font-size: 0.82rem; font-weight: 500;
		text-decoration: none; position: relative;
		transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.nav-item:hover { color: var(--text-primary); background: rgba(255,255,255,0.03); }
	.nav-item.active { color: var(--accent); background: rgba(249,115,22,0.08); }
	.nav-item.active::after {
		content: ''; position: absolute; bottom: -1px; left: 50%; transform: translateX(-50%);
		width: 16px; height: 2px; border-radius: 1px;
		background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
		animation: nav-glow 2s ease-in-out infinite;
	}
	.nav-icon { font-size: 0.7rem; }
	.nav-item.active .nav-icon {
		filter: drop-shadow(0 0 4px var(--accent-glow-strong));
		animation: icon-pulse 3s ease-in-out infinite;
	}
	.nav-label { letter-spacing: 0.01em; }

	/* Mobile nav dropdown */
	.nav-mobile { display: none; position: relative; }
	.nav-current {
		display: flex; align-items: center; gap: 8px;
		background: rgba(249,115,22,0.08); border: 1px solid var(--accent-border);
		border-radius: 10px; padding: 8px 14px;
		color: var(--accent); font-size: 0.9rem; font-weight: 600;
		cursor: pointer; transition: all 0.2s;
	}
	.nav-current:hover { background: rgba(249,115,22,0.12); }
	.nav-current-icon { font-size: 0.8rem; }
	.nav-current-label { letter-spacing: 0.01em; }
	.nav-chevron {
		font-size: 0.65rem; transition: transform 0.2s;
		margin-left: 2px;
	}
	.nav-chevron.open { transform: rotate(180deg); }
	.nav-dropdown {
		position: absolute; top: calc(100% + 6px); left: 0;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.08);
		border-radius: 12px; padding: 6px; z-index: 200;
		min-width: 180px;
		box-shadow: 0 8px 32px rgba(0,0,0,0.4);
		animation: dropdown-in 0.15s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes dropdown-in {
		from { opacity: 0; transform: translateY(-8px) scale(0.95); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}
	.nav-drop-item {
		display: flex; align-items: center; gap: 10px;
		width: 100%; padding: 12px 14px; border: none; border-radius: 8px;
		background: none; color: var(--text-secondary); font-size: 0.9rem;
		font-weight: 500; cursor: pointer; text-align: left;
		transition: all 0.15s;
	}
	.nav-drop-item:hover { background: rgba(255,255,255,0.04); color: var(--text-primary); }
	.nav-drop-item.active { color: var(--accent); background: rgba(249,115,22,0.08); }
	.nav-drop-icon { font-size: 0.85rem; width: 20px; text-align: center; }

	.nav-badge {
		background: var(--accent); color: #000; font-size: 0.6rem; font-weight: 700;
		min-width: 16px; height: 16px; border-radius: 8px;
		display: flex; align-items: center; justify-content: center;
		padding: 0 4px; line-height: 1;
	}

	@keyframes nav-glow {
		0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--accent-glow); }
		50% { opacity: 0.6; box-shadow: 0 0 16px var(--accent-glow-strong); }
	}
	@keyframes icon-pulse {
		0%, 100% { transform: scale(1); }
		50% { transform: scale(1.1); }
	}

	/* Right side */
	.nav-right { display: flex; align-items: center; gap: 10px; position: relative; }
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
		width: 320px; padding: 14px; z-index: 100;
		background: var(--bg-raised); border: 1px solid rgba(255,255,255,0.08);
	}
	.menu-label { color: var(--text-secondary); font-size: 0.75rem; margin-bottom: 8px; }
	.menu-address {
		display: block; font-size: 0.65rem; color: var(--accent);
		word-break: break-all; margin-bottom: 12px;
		padding: 8px; background: var(--bg-input); border-radius: 6px;
	}
	.menu-link {
		display: block; text-align: center; margin-top: 8px;
		color: var(--text-secondary); font-size: 0.8rem; padding: 6px;
		border-top: 1px solid rgba(255,255,255,0.04);
	}
	.menu-link:hover { color: var(--accent); }
	main { min-height: 70vh; }

	/* Mobile breakpoint */
	@media (max-width: 640px) {
		.app { padding: 0 10px; max-width: 100%; }
		nav { padding: 10px 0; margin-bottom: 12px; }
		.logo { font-size: 1.1em; }
		.nav-desktop { display: none; }
		.nav-mobile { display: block; }
		.user-btn { padding: 4px 6px; font-size: 0.7rem; }
		.user-btn .mono { display: none; }
		.user-btn .caret { display: none; }
		.user-btn::before { content: '⚙'; font-size: 0.9rem; }
		.status-text { display: none; }
		.user-menu { width: calc(100vw - 20px); right: -10px; }
	}
</style>
