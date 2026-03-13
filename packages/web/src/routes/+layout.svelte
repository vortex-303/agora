<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { loadIdentity } from '$lib/identity.js';
	import { identityState, connectionState } from '$lib/stores.svelte.js';
	import { RelayClient } from '$lib/relay.js';

	let { children } = $props();
	let relayClient: RelayClient | null = $state(null);
	const RELAY_URL = typeof window !== 'undefined'
		? (localStorage.getItem('agora_relay_url') || `ws://${window.location.hostname}:9800`)
		: 'ws://localhost:9800';

	onMount(async () => {
		const identity = await loadIdentity();
		if (!identity) {
			if (!window.location.pathname.startsWith('/setup')) {
				goto('/setup');
			}
			return;
		}
		identityState.identity = identity;

		// Connect to relay
		const client = new RelayClient(RELAY_URL, identity);
		client.setHandlers({
			onStatus: (status) => { connectionState.status = status; },
		});
		client.connect();
		relayClient = client;

		// Make relay available globally for child components
		(window as any).__agora_relay = client;
	});
</script>

<svelte:head>
	<title>Agora</title>
	<meta name="description" content="Decentralized social platform" />
</svelte:head>

<div class="app">
	<nav>
		<a href="/" class="logo">Agora</a>
		<div class="nav-right">
			{#if identityState.identity}
				<span class="status" class:connected={connectionState.status === 'connected'} class:connecting={connectionState.status === 'connecting' || connectionState.status === 'authenticating'}>
					{connectionState.status}
				</span>
				<span class="pubkey" title={identityState.identity.publicKeyBase64}>
					{identityState.identity.publicKeyBase64.slice(0, 8)}...
				</span>
			{/if}
		</div>
	</nav>
	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		background: #0a0a0a;
		color: #e0e0e0;
	}
	:global(a) {
		color: #6eb5ff;
		text-decoration: none;
	}
	:global(a:hover) {
		text-decoration: underline;
	}
	.app {
		max-width: 640px;
		margin: 0 auto;
		padding: 0 16px;
	}
	nav {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 0;
		border-bottom: 1px solid #222;
		margin-bottom: 16px;
	}
	.logo {
		font-size: 1.4em;
		font-weight: 700;
		color: #fff;
	}
	.logo:hover {
		text-decoration: none;
	}
	.nav-right {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 0.85em;
	}
	.status {
		padding: 2px 8px;
		border-radius: 12px;
		background: #333;
		color: #888;
		font-size: 0.8em;
	}
	.status.connected {
		background: #1a3a1a;
		color: #4caf50;
	}
	.status.connecting {
		background: #3a3a1a;
		color: #ffc107;
	}
	.pubkey {
		color: #888;
		font-family: monospace;
		font-size: 0.85em;
	}
	main {
		min-height: 70vh;
	}
</style>
