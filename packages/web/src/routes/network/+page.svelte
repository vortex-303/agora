<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, connectionState } from '$lib/stores.svelte.js';
	import type { Profile } from '$lib/profiles.js';

	let people = $state<Profile[]>([]);
	let peerCount = $state(0);
	let addAddress = $state('');

	onMount(() => {
		const check = setInterval(() => {
			const pm = appState.profileManager;
			const fm = appState.feedManager;
			if (pm && fm) {
				clearInterval(check);
				const refresh = () => {
					people = pm.getAllProfiles();
					peerCount = fm.peerManager.getConnectedCount();
				};
				pm.onChange(refresh);
				fm.peerManager.onChange(refresh);
				const poll = setInterval(() => { fm.relay.requestPeers(); refresh(); }, 10_000);
				fm.relay.requestPeers();
				refresh();
				return () => clearInterval(poll);
			}
		}, 50);
		return () => clearInterval(check);
	});

	let onlinePeople = $derived(people.filter(p => p.online));
	let offlinePeople = $derived(people.filter(p => !p.online));
</script>

<div class="header">
	<h2>Network</h2>
	<div class="stats">
		<span class="badge badge-connected">{peerCount} P2P</span>
		<span class="badge {connectionState.status === 'connected' ? 'badge-connected' : 'badge-disconnected'}">
			relay {connectionState.status === 'connected' ? 'live' : 'off'}
		</span>
	</div>
</div>

{#if onlinePeople.length > 0}
	<h3 class="section-title">
		<span class="dot-live"></span> Online now
	</h3>
	<div class="people-list">
		{#each onlinePeople as person (person.publicKey)}
			<a href="/dm/{encodeURIComponent(person.publicKey)}" class="person card">
				<div class="person-left">
					<div class="person-avatar">{person.publicKey.slice(0, 2)}</div>
					<div class="person-text">
						<span class="person-name mono">{person.name || person.publicKey.slice(0, 12) + '...'}</span>
						{#if person.city || person.country}
							<span class="person-location">{[person.city, person.country].filter(Boolean).join(', ')}</span>
						{/if}
					</div>
				</div>
				<span class="person-action">Message →</span>
			</a>
		{/each}
	</div>
{/if}

{#if offlinePeople.length > 0}
	<h3 class="section-title">Known</h3>
	<div class="people-list">
		{#each offlinePeople as person (person.publicKey)}
			<a href="/dm/{encodeURIComponent(person.publicKey)}" class="person card">
				<div class="person-left">
					<div class="person-avatar off">{person.publicKey.slice(0, 2)}</div>
					<div class="person-text">
						<span class="person-name mono">{person.name || person.publicKey.slice(0, 12) + '...'}</span>
						{#if person.city || person.country}
							<span class="person-location">{[person.city, person.country].filter(Boolean).join(', ')}</span>
						{/if}
					</div>
				</div>
				<span class="person-action">Message →</span>
			</a>
		{/each}
	</div>
{/if}

{#if people.length === 0}
	<div class="empty">
		<p>No one on the network yet.</p>
		<p class="sub">Share your address (top right menu) or open another tab.</p>
	</div>
{/if}

<div class="add-section">
	<h3 class="section-title">Add someone</h3>
	<div class="add-row">
		<input class="input mono" bind:value={addAddress} placeholder="Paste their public address" />
		<a href="/dm/{encodeURIComponent(addAddress)}" class="btn" class:disabled={!addAddress.trim()}>Chat</a>
	</div>
</div>

<style>
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
	h2 { color: var(--text-primary); margin: 0; font-size: 1.3rem; }
	h3.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em;
		margin: 28px 0 12px; display: flex; align-items: center; gap: 6px;
	}
	.stats { display: flex; gap: 8px; }
	.dot-live {
		display: inline-block; width: 6px; height: 6px; border-radius: 50%;
		background: #4ade80; animation: pulse-dot 2s infinite;
	}
	.people-list { display: flex; flex-direction: column; gap: 6px; }
	.person {
		display: flex; justify-content: space-between; align-items: center;
		padding: 12px 14px; text-decoration: none; color: inherit; cursor: pointer; transition: all 0.2s;
	}
	.person:hover { border-color: var(--accent-border); box-shadow: var(--shadow-glow); }
	.person-left { display: flex; align-items: center; gap: 10px; }
	.person-avatar {
		width: 36px; height: 36px; border-radius: 50%;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.person-avatar.off { opacity: 0.4; }
	.person-text { display: flex; flex-direction: column; gap: 2px; }
	.person-name { color: var(--text-primary); font-size: 0.85rem; }
	.person-location { color: var(--text-tertiary); font-size: 0.7rem; }
	.person-action {
		color: var(--accent); font-size: 0.8rem; font-weight: 500;
		opacity: 0; transition: opacity 0.2s;
	}
	.person:hover .person-action { opacity: 1; }
	.empty { text-align: center; margin: 64px 0; color: var(--text-tertiary); }
	.empty .sub { font-size: 0.85rem; }
	.add-section { margin-top: 32px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,0.04); }
	.add-row { display: flex; gap: 8px; }
	.add-row .input { flex: 1; font-size: 0.8rem; }
	.disabled { opacity: 0.3; pointer-events: none; }
</style>
