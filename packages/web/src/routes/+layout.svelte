<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { loadIdentity } from '$lib/identity.js';
	import { identityState, connectionState, appState, triggerReactive } from '$lib/stores.svelte.js';
	import { FeedManager } from '$lib/feed.js';
	import { ProfileManager } from '$lib/profiles.js';
	import { DMManager } from '$lib/dm.js';
	import { VoteManager } from '$lib/votes.js';
	import { ClientModeration } from '$lib/moderation-client.js';
	import { CommunityManager } from '$lib/communities.js';
	import { AccountSync } from '$lib/account-sync.js';
	import { SeedMode } from '$lib/seed-mode.js';
	import GridCanvas from '$lib/GridCanvas.svelte';
	import '$lib/theme.css';

	let { children } = $props();
	let copied = $state(false);

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

		const fm = new FeedManager(identity);
		fm.onStatusChange((status) => { connectionState.status = status; });
		await fm.init();
		appState.feedManager = fm;

		const pm = new ProfileManager(fm, identity);
		await pm.init();
		appState.profileManager = pm;

		const dm = new DMManager(fm, identity);
		await dm.init();
		appState.dmManager = dm;

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

		const as = new AccountSync(fm, identity);
		await as.init();
		appState.accountSync = as;

		const sm = new SeedMode(fm);
		sm.init();
		sm.onChange(triggerReactive);
		appState.seedMode = sm;
	});

	function copyAddress() {
		if (!identityState.identity) return;
		navigator.clipboard.writeText(identityState.identity.publicKeyBase64);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
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
		connectionState.status === 'connecting' ? 'badge-connecting' :
		'badge-disconnected'
	);

	let isFullscreen = $derived(
		$page.url.pathname.startsWith('/setup') || $page.url.pathname.startsWith('/p/') ||
		$page.url.pathname.startsWith('/join/')
	);

	let displayName = $derived(
		appState.profileManager?.getProfile(identityState.identity?.publicKeyBase64 || '')?.name ||
		identityState.identity?.publicKeyBase64.slice(0, 8) + '...'
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

<div class="grid-bg"></div>
<div class="glow glow-1"></div>
<div class="glow glow-2"></div>
<GridCanvas />

{#if isFullscreen || !identityState.identity}
	<!-- Fullscreen: setup, public profiles, join links -->
	<div class="fullscreen">
		{@render children()}
	</div>
{:else}
	<!-- App shell: sidebar + main -->
	<div class="shell">
		<aside class="sidebar">
			<div class="sidebar-top">
				<a href="/" class="logo">riot<span class="logo-dot">.</span></a>
				<span class="badge {statusClass}">
					<span class="dot"></span>
					<span class="status-label">{connectionState.status === 'connected' ? 'online' : 'connecting'}</span>
				</span>
			</div>

			<nav class="sidebar-nav">
				<a href="/" class="nav-item" class:active={$page.url.pathname === '/'}>
					<span class="nav-icon">&#x1F3E0;</span>
					<span>Lobby</span>
				</a>
				<a href="/dm" class="nav-item" class:active={$page.url.pathname.startsWith('/dm')}>
					<span class="nav-icon">&#x1F4AC;</span>
					<span>Messages</span>
					{#if unreadDMs > 0}
						<span class="nav-badge">{unreadDMs}</span>
					{/if}
				</a>
				<a href="/network" class="nav-item" class:active={$page.url.pathname === '/network'}>
					<span class="nav-icon">&#x1F310;</span>
					<span>Network</span>
				</a>
				<a href="/settings" class="nav-item" class:active={$page.url.pathname === '/settings'}>
					<span class="nav-icon">&#x2699;</span>
					<span>Settings</span>
				</a>
			</nav>

			<div class="sidebar-bottom">
				<div class="user-card">
					<div class="user-avatar">{identityState.identity.publicKeyBase64.slice(0, 2)}</div>
					<div class="user-info">
						<span class="user-name">{displayName}</span>
						<button class="copy-key" onclick={copyAddress}>
							<span class="mono">{identityState.identity.publicKeyBase64.slice(0, 12)}...</span>
							{#if copied}<span class="copied-label">copied!</span>{/if}
						</button>
					</div>
				</div>
			</div>
		</aside>

		<main class="main-panel" class:main-fluid={$page.url.pathname.startsWith('/dm')}>
			{@render children()}
		</main>
	</div>
{/if}

<style>
	.fullscreen { position: relative; z-index: 1; }

	/* Shell */
	.shell {
		position: relative; z-index: 1;
		display: flex; height: 100vh; overflow: hidden;
	}

	/* Sidebar */
	.sidebar {
		width: 240px; min-width: 240px; flex-shrink: 0;
		display: flex; flex-direction: column;
		background: var(--bg-root);
		border-right: 1px solid rgba(255,255,255,0.04);
		padding: 0;
	}

	.sidebar-top {
		display: flex; justify-content: space-between; align-items: center;
		padding: 20px 20px 16px;
	}
	.logo { font-size: 1.3em; font-weight: 700; color: var(--text-primary); letter-spacing: -0.02em; text-decoration: none; }
	.logo:hover { color: var(--text-primary); }
	.logo-dot { color: var(--accent); }

	.badge { display: flex; align-items: center; gap: 4px; font-size: 0.65rem; padding: 3px 8px; border-radius: 10px; }
	.badge-connected { color: #4ade80; background: rgba(74,222,128,0.08); }
	.badge-connecting { color: #facc15; background: rgba(250,204,21,0.08); }
	.badge-disconnected { color: var(--text-tertiary); background: rgba(255,255,255,0.03); }
	.dot { display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: pulse-dot 2s infinite; }
	.status-label { font-weight: 500; }

	.sidebar-nav {
		flex: 1; display: flex; flex-direction: column; gap: 2px;
		padding: 8px 12px;
	}
	.nav-item {
		display: flex; align-items: center; gap: 10px;
		padding: 10px 12px; border-radius: 8px;
		font-size: 0.85rem; font-weight: 500;
		color: var(--text-secondary); text-decoration: none;
		transition: all 0.15s;
	}
	.nav-item:hover { color: var(--text-primary); background: rgba(255,255,255,0.03); }
	.nav-item.active { color: var(--accent); background: rgba(249,115,22,0.08); }
	.nav-icon { font-size: 1rem; width: 20px; text-align: center; }
	.nav-badge {
		margin-left: auto;
		background: var(--accent); color: #000; font-size: 0.6rem; font-weight: 700;
		min-width: 18px; height: 18px; border-radius: 9px;
		display: flex; align-items: center; justify-content: center; padding: 0 5px;
	}

	.sidebar-bottom {
		padding: 12px;
		border-top: 1px solid rgba(255,255,255,0.04);
	}
	.user-card {
		display: flex; align-items: center; gap: 10px;
		padding: 8px; border-radius: 8px;
	}
	.user-avatar {
		width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.user-info { min-width: 0; }
	.user-name { display: block; font-size: 0.82rem; font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.copy-key {
		display: block; background: none; border: none; padding: 0; cursor: pointer;
		font-size: 0.65rem; color: var(--text-tertiary); font-family: var(--font-mono);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;
		transition: color 0.15s;
	}
	.copy-key:hover { color: var(--accent); }
	.copied-label { color: #4ade80; margin-left: 4px; font-family: var(--font-sans); }

	/* Main panel */
	.main-panel {
		flex: 1; overflow-y: auto; overflow-x: hidden;
		padding: 28px 32px;
		min-width: 0;
	}
	.main-panel.main-fluid {
		padding: 0;
		overflow: hidden;
	}

	/* Mobile */
	@media (max-width: 768px) {
		.shell { flex-direction: column; }

		.sidebar {
			width: 100%; min-width: 100%; flex-shrink: 0;
			flex-direction: row; align-items: center;
			border-right: none; border-bottom: 1px solid rgba(255,255,255,0.04);
			padding: 0; height: auto;
			position: fixed; bottom: 0; left: 0; right: 0; z-index: 50;
			background: var(--bg-root);
		}
		.sidebar-top { display: none; }
		.sidebar-bottom { display: none; }
		.sidebar-nav {
			flex-direction: row; justify-content: space-around;
			padding: 6px 0; gap: 0; width: 100%;
		}
		.nav-item {
			flex-direction: column; gap: 2px; padding: 6px 12px;
			font-size: 0.65rem; border-radius: 0;
		}
		.nav-icon { font-size: 1.1rem; }

		.main-panel {
			padding: 16px 12px; padding-bottom: 70px;
			height: calc(100vh - 56px);
		}
		.main-panel.main-fluid {
			padding: 0; padding-bottom: 56px;
		}
	}
</style>
