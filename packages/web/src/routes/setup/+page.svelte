<script lang="ts">
	import { goto } from '$app/navigation';
	import { generateIdentity, restoreIdentity } from '$lib/identity.js';
	import { saveIdentity } from '$lib/identity.js';
	import { identityState } from '$lib/stores.svelte.js';
	import type { Identity } from '@agora/core';
	import '$lib/theme.css';

	let mode = $state<'choose' | 'create' | 'restore'>('choose');
	let mnemonic = $state('');
	let generatedIdentity = $state<Identity | null>(null);
	let confirmed = $state(false);
	let restorePhrase = $state('');
	let error = $state('');

	function create() {
		generatedIdentity = generateIdentity();
		mnemonic = generatedIdentity.mnemonic;
		mode = 'create';
	}

	function getRedirect(): string {
		const joinAddr = sessionStorage.getItem('agora_join_address');
		if (joinAddr) {
			sessionStorage.removeItem('agora_join_address');
			sessionStorage.setItem('agora_dm_open', joinAddr);
			return '/dm';
		}
		return '/';
	}

	async function confirmBackup() {
		if (!generatedIdentity) return;
		await saveIdentity(generatedIdentity);
		identityState.identity = generatedIdentity;
		goto(getRedirect());
	}

	async function restore() {
		error = '';
		try {
			const identity = restoreIdentity(restorePhrase);
			await saveIdentity(identity);
			identityState.identity = identity;
			goto(getRedirect());
		} catch {
			error = 'Invalid recovery phrase.';
		}
	}
</script>

<div class="setup">
	{#if mode === 'choose'}
		<div class="hero">
			<h1>agora<span class="dot">.</span></h1>
			<p class="tagline">Decentralized. Encrypted. Yours.</p>
			<p class="desc">No email. No password. No server owns your data. Your identity is a cryptographic keypair that you control.</p>
		</div>
		<div class="actions">
			<button class="btn" onclick={create}>Create Identity</button>
			<button class="btn btn-secondary" onclick={() => mode = 'restore'}>Restore from Phrase</button>
		</div>
	{:else if mode === 'create'}
		<h2>Recovery Phrase</h2>
		<p class="desc">Write down these 12 words. They are the <strong>only</strong> way to recover your identity.</p>
		<div class="mnemonic card">
			{#each mnemonic.split(' ') as word, i}
				<span class="word"><em>{i + 1}</em>{word}</span>
			{/each}
		</div>
		<label class="confirm-row">
			<input type="checkbox" bind:checked={confirmed} />
			<span>I've written down my phrase</span>
		</label>
		<button class="btn" onclick={confirmBackup} disabled={!confirmed}>Enter the Agora</button>
	{:else}
		<h2>Restore Identity</h2>
		<p class="desc">Enter your 12-word recovery phrase.</p>
		<textarea class="input" bind:value={restorePhrase} placeholder="word1 word2 word3 ..." rows="3"></textarea>
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<div class="actions">
			<button class="btn" onclick={restore} disabled={!restorePhrase.trim()}>Restore</button>
			<button class="btn btn-secondary" onclick={() => mode = 'choose'}>Back</button>
		</div>
	{/if}
</div>

<style>
	.setup { max-width: 440px; margin: 80px auto; }
	.hero { margin-bottom: 40px; }
	h1 { font-size: 3rem; margin: 0; letter-spacing: -0.03em; }
	.dot { color: var(--accent); }
	.tagline {
		color: var(--accent); font-size: 1.1rem; font-weight: 500;
		margin: 4px 0 16px; letter-spacing: 0.02em;
	}
	h2 { font-size: 1.4rem; margin: 0 0 8px; }
	.desc { color: var(--text-secondary); line-height: 1.6; margin-bottom: 24px; font-size: 0.9rem; }
	.desc strong { color: var(--accent); }
	.mnemonic {
		display: grid; grid-template-columns: 1fr 1fr 1fr;
		gap: 8px; margin-bottom: 24px; padding: 20px;
	}
	.word { font-family: var(--font-mono); font-size: 0.9rem; }
	.word em {
		font-style: normal; color: var(--text-tertiary);
		margin-right: 6px; font-size: 0.75rem;
	}
	.actions { display: flex; gap: 10px; }
	.confirm-row {
		display: flex; align-items: center; gap: 8px;
		margin-bottom: 20px; color: var(--text-secondary); cursor: pointer;
		font-size: 0.9rem;
	}
	.confirm-row input { accent-color: var(--accent); }
	.error { color: #f87171; font-size: 0.85rem; margin-bottom: 12px; }
	textarea { resize: vertical; min-height: 80px; margin-bottom: 12px; }
</style>
