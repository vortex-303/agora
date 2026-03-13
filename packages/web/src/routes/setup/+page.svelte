<script lang="ts">
	import { goto } from '$app/navigation';
	import { generateIdentity, restoreIdentity } from '$lib/identity.js';
	import { saveIdentity } from '$lib/identity.js';
	import { identityState } from '$lib/stores.svelte.js';
	import type { Identity } from '@agora/core';

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

	async function confirmBackup() {
		if (!generatedIdentity) return;
		await saveIdentity(generatedIdentity);
		identityState.identity = generatedIdentity;
		goto('/');
	}

	async function restore() {
		error = '';
		try {
			const identity = restoreIdentity(restorePhrase);
			await saveIdentity(identity);
			identityState.identity = identity;
			goto('/');
		} catch (e) {
			error = 'Invalid recovery phrase. Check your words and try again.';
		}
	}
</script>

<div class="setup">
	{#if mode === 'choose'}
		<h1>Welcome to Agora</h1>
		<p>A decentralized social platform. Your identity is a cryptographic keypair — no email, no password, no server.</p>
		<div class="buttons">
			<button onclick={create}>Create New Identity</button>
			<button class="secondary" onclick={() => mode = 'restore'}>Restore from Phrase</button>
		</div>
	{:else if mode === 'create'}
		<h1>Your Recovery Phrase</h1>
		<p>Write down these 12 words. They are the only way to recover your identity.</p>
		<div class="mnemonic">
			{#each mnemonic.split(' ') as word, i}
				<span class="word"><em>{i + 1}.</em> {word}</span>
			{/each}
		</div>
		<label class="confirm-label">
			<input type="checkbox" bind:checked={confirmed} />
			I have written down my recovery phrase
		</label>
		<button onclick={confirmBackup} disabled={!confirmed}>Continue</button>
	{:else}
		<h1>Restore Identity</h1>
		<p>Enter your 12-word recovery phrase.</p>
		<textarea bind:value={restorePhrase} placeholder="word1 word2 word3 ..." rows="3"></textarea>
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<div class="buttons">
			<button onclick={restore} disabled={!restorePhrase.trim()}>Restore</button>
			<button class="secondary" onclick={() => mode = 'choose'}>Back</button>
		</div>
	{/if}
</div>

<style>
	.setup {
		max-width: 480px;
		margin: 48px auto;
	}
	h1 {
		font-size: 1.6em;
		margin-bottom: 8px;
		color: #fff;
	}
	p {
		color: #aaa;
		line-height: 1.5;
		margin-bottom: 24px;
	}
	.mnemonic {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
		margin-bottom: 24px;
		background: #1a1a1a;
		padding: 16px;
		border-radius: 8px;
	}
	.word {
		font-size: 1em;
	}
	.word em {
		color: #555;
		font-style: normal;
		margin-right: 4px;
	}
	.buttons {
		display: flex;
		gap: 12px;
	}
	button {
		background: #6eb5ff;
		color: #000;
		border: none;
		border-radius: 6px;
		padding: 12px 24px;
		font-size: 1em;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	button.secondary {
		background: #333;
		color: #e0e0e0;
	}
	textarea {
		width: 100%;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		color: #e0e0e0;
		padding: 12px;
		font-size: 1em;
		box-sizing: border-box;
		font-family: inherit;
		margin-bottom: 12px;
	}
	.error {
		color: #ff6b6b;
		font-size: 0.9em;
	}
	.confirm-label {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
		color: #aaa;
		cursor: pointer;
	}
</style>
