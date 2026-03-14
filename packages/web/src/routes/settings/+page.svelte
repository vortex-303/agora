<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type ProfileContent } from '@agora/core';
	import { identityState, appState } from '$lib/stores.svelte.js';
	import { clearIdentity } from '$lib/identity.js';
	import { DEFAULT_RELAYS } from '$lib/relay-pool.js';

	let username = $state('');
	let bio = $state('');
	let saved = $state(false);
	let copied = $state(false);
	let relays = $state<string[]>([]);
	let newRelay = $state('');

	onMount(() => {
		// Load relays
		const stored = localStorage.getItem('agora_relays');
		if (stored) {
			try { relays = JSON.parse(stored); } catch {}
		}
		if (relays.length === 0) relays = [...DEFAULT_RELAYS];

		const check = setInterval(() => {
			const pm = appState.profileManager;
			const id = identityState.identity;
			if (pm && id) {
				clearInterval(check);
				const profile = pm.getProfile(id.publicKeyBase64);
				if (profile?.name) username = profile.name;
			}
		}, 50);
		return () => clearInterval(check);
	});

	function saveProfile() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		const pm = appState.profileManager;
		if (!identity || !fm || !pm) return;
		const existing = pm.getProfile(identity.publicKeyBase64);
		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'profile',
			content: {
				name: username.trim() || undefined,
				bio: bio.trim() || undefined,
				x25519PublicKey: existing?.x25519PublicKey,
			} as ProfileContent,
			seq: state.seq + 1,
			prev: state.lastId,
		});
		fm.publish(obj);
		saved = true;
		setTimeout(() => { saved = false; }, 2000);
	}

	function addRelay() {
		const url = newRelay.trim();
		if (!url || relays.includes(url)) return;
		if (!url.startsWith('ws://') && !url.startsWith('wss://')) return;
		relays = [...relays, url];
		localStorage.setItem('agora_relays', JSON.stringify(relays));
		newRelay = '';
	}

	function removeRelay(url: string) {
		relays = relays.filter((r) => r !== url);
		localStorage.setItem('agora_relays', JSON.stringify(relays));
	}

	function copyAddress() {
		if (!identityState.identity) return;
		navigator.clipboard.writeText(identityState.identity.publicKeyBase64);
		copied = true;
		setTimeout(() => { copied = false; }, 2000);
	}

	async function logout() {
		await clearIdentity();
		window.location.href = '/setup';
	}
</script>

<h2>Settings</h2>

{#if identityState.identity}
	<div class="section card">
		<h3 class="section-title">Profile</h3>
		<label class="field">
			<span class="field-label">Username</span>
			<input class="input" bind:value={username} placeholder="Anonymous" />
		</label>
		<label class="field">
			<span class="field-label">Bio</span>
			<input class="input" bind:value={bio} placeholder="Say something about yourself" />
		</label>
		<button class="btn" onclick={saveProfile}>
			{saved ? 'Saved!' : 'Save Profile'}
		</button>
	</div>

	<div class="section card">
		<h3 class="section-title">Relays</h3>
		<p class="relay-hint">Connect to multiple relays for decentralization. Changes apply on next page load.</p>
		<div class="relay-list">
			{#each relays as url (url)}
				<div class="relay-item">
					<span class="relay-url mono">{url}</span>
					<button class="relay-remove" onclick={() => removeRelay(url)}
						disabled={relays.length <= 1}>✕</button>
				</div>
			{/each}
		</div>
		<div class="relay-add">
			<input class="input mono" bind:value={newRelay} placeholder="wss://relay.example.com"
				onkeydown={(e) => { if (e.key === 'Enter') addRelay(); }} />
			<button class="btn btn-secondary" onclick={addRelay}>Add</button>
		</div>
	</div>

	<div class="section card">
		<h3 class="section-title">Identity</h3>
		<label class="field">
			<span class="field-label">Public address</span>
			<div class="address-row">
				<code class="mono address-text">{identityState.identity.publicKeyBase64}</code>
				<button class="btn btn-secondary" onclick={copyAddress}>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
		</label>
		<label class="field">
			<span class="field-label">Recovery phrase</span>
			<div class="mnemonic-warn">
				Your 12-word phrase is the only way to recover this identity.
				It was shown during setup.
			</div>
		</label>
	</div>

	<div class="section">
		<button class="btn btn-danger" onclick={logout}>Sign Out</button>
		<p class="warn-text">This clears your identity from this browser. You'll need your recovery phrase to sign back in.</p>
	</div>
{/if}

<style>
	h2 { color: var(--text-primary); margin: 0 0 20px; font-size: 1.3rem; }
	h3.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 16px;
	}
	.section { margin-bottom: 20px; padding: 18px; }
	.field { display: block; margin-bottom: 14px; }
	.field-label { display: block; color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 6px; }
	.address-row { display: flex; gap: 8px; align-items: center; }
	.address-text {
		flex: 1; font-size: 0.65rem; color: var(--accent);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		padding: 8px 10px; background: var(--bg-input); border-radius: 6px;
		border: 1px solid rgba(255,255,255,0.04);
	}
	.mnemonic-warn { color: var(--text-tertiary); font-size: 0.8rem; line-height: 1.5; }
	.btn-danger {
		background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.2);
	}
	.btn-danger:hover { background: rgba(239,68,68,0.25); box-shadow: none; transform: none; }
	.warn-text { color: var(--text-tertiary); font-size: 0.75rem; margin-top: 8px; }

	/* Relays */
	.relay-hint { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 12px; }
	.relay-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
	.relay-item {
		display: flex; justify-content: space-between; align-items: center;
		padding: 8px 12px; background: var(--bg-input); border-radius: 6px;
	}
	.relay-url { font-size: 0.75rem; color: var(--text-primary); }
	.relay-remove {
		background: none; border: none; color: var(--text-tertiary);
		cursor: pointer; font-size: 0.8rem; padding: 2px 6px;
	}
	.relay-remove:hover { color: #f87171; }
	.relay-remove:disabled { opacity: 0.2; cursor: default; }
	.relay-add { display: flex; gap: 8px; }
	.relay-add .input { flex: 1; font-size: 0.75rem; }
</style>
