<script lang="ts">
	import { goto } from '$app/navigation';
	import { generateIdentity, restoreIdentity } from '$lib/identity.js';
	import { saveIdentity } from '$lib/identity.js';
	import { identityState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';
	import type { Identity } from '@agora/core';
	import GridCanvas from '$lib/GridCanvas.svelte';
	import '$lib/theme.css';

	let mode = $state<'choose' | 'create' | 'name' | 'restore'>('choose');
	let mnemonic = $state('');
	let generatedIdentity = $state<Identity | null>(null);
	let confirmed = $state(false);
	let restorePhrase = $state('');
	let error = $state('');
	let username = $state('');

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

	function confirmBackup() {
		mode = 'name';
	}

	async function finish() {
		if (!generatedIdentity) return;
		await saveIdentity(generatedIdentity);
		identityState.identity = generatedIdentity;
		// Store username for profile publish on first connect
		if (username.trim()) {
			localStorage.setItem('agora_pending_username', username.trim());
		}
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

<div class="grid-bg"></div>
<div class="glow glow-1"></div>
<div class="glow glow-2"></div>
<GridCanvas />

<div class="setup">
	{#if mode === 'choose'}
		<div class="hero">
			<h1>agora<span class="dot">.</span></h1>
			<p class="tagline">The public square owned by no one.</p>
			<p class="desc">No email. No password. No surveillance. Your identity is a cryptographic keypair that only you control.</p>
			<div class="features">
				<div class="feature">
					<span class="fi">🔑</span>
					<span>Cryptographic identity</span>
				</div>
				<div class="feature">
					<span class="fi">🔒</span>
					<span>E2E encrypted DMs</span>
				</div>
				<div class="feature">
					<span class="fi">🌐</span>
					<span>Peer-to-peer gossip</span>
				</div>
			</div>
		</div>
		<div class="actions">
			<button class="btn-big" onclick={create}>Create Identity</button>
			<button class="btn-link" onclick={() => mode = 'restore'}>I have a recovery phrase</button>
		</div>
	{:else if mode === 'create'}
		<h2>Your Recovery Phrase</h2>
		<p class="desc">These 12 words are the <strong>only</strong> way to recover your identity. Write them down somewhere safe.</p>
		<div class="mnemonic card">
			{#each mnemonic.split(' ') as word, i}
				<span class="word"><em>{i + 1}</em>{word}</span>
			{/each}
		</div>
		<label class="confirm-row">
			<input type="checkbox" bind:checked={confirmed} />
			<span>I've saved my recovery phrase</span>
		</label>
		<button class="btn-big" onclick={confirmBackup} disabled={!confirmed}>Continue</button>
	{:else if mode === 'name'}
		<h2>Pick a username</h2>
		<p class="desc">Optional. You can change this anytime in Settings. Others will see this instead of your public key.</p>
		<input class="input name-input" bind:value={username} placeholder="Anonymous" autofocus
			onkeydown={(e) => { if (e.key === 'Enter') finish(); }} />
		<div class="topics-preview">
			<p class="topics-label">You'll find conversations in:</p>
			<div class="topic-pills">
				{#each TOPICS as topic}
					<span class="topic-pill">#{topic.label}</span>
				{/each}
			</div>
		</div>
		<button class="btn-big" onclick={finish}>Enter the Agora</button>
	{:else}
		<h2>Restore Identity</h2>
		<p class="desc">Enter your 12-word recovery phrase.</p>
		<textarea class="input" bind:value={restorePhrase} placeholder="word1 word2 word3 ..." rows="3"></textarea>
		{#if error}
			<p class="error">{error}</p>
		{/if}
		<div class="actions">
			<button class="btn-big" onclick={restore} disabled={!restorePhrase.trim()}>Restore</button>
			<button class="btn-link" onclick={() => mode = 'choose'}>Back</button>
		</div>
	{/if}
</div>

<style>
	.setup { max-width: 440px; margin: 0 auto; padding: 80px 16px; position: relative; z-index: 1; }
	.hero { margin-bottom: 40px; }
	h1 { font-size: 3rem; margin: 0; letter-spacing: -0.03em; color: var(--text-primary); }
	.dot { color: var(--accent); }
	.tagline { color: var(--accent); font-size: 1.1rem; font-weight: 500; margin: 4px 0 16px; }
	h2 { font-size: 1.4rem; margin: 0 0 8px; color: var(--text-primary); }
	.desc { color: var(--text-secondary); line-height: 1.6; margin-bottom: 24px; font-size: 0.9rem; }
	.desc strong { color: var(--accent); }
	.features { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
	.feature { display: flex; align-items: center; gap: 10px; color: var(--text-secondary); font-size: 0.9rem; }
	.fi { font-size: 1.1rem; }
	.mnemonic {
		display: grid; grid-template-columns: 1fr 1fr 1fr;
		gap: 8px; margin-bottom: 24px; padding: 20px;
	}
	.word { font-family: var(--font-mono); font-size: 0.9rem; color: var(--text-primary); }
	.word em { font-style: normal; color: var(--text-tertiary); margin-right: 6px; font-size: 0.75rem; }
	.actions { display: flex; flex-direction: column; gap: 12px; }
	.btn-big {
		width: 100%; background: var(--accent); color: #000; border: none; border-radius: 10px;
		padding: 14px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.2s;
	}
	.btn-big:hover { background: var(--accent-hover); box-shadow: 0 0 40px var(--accent-glow); }
	.btn-big:disabled { opacity: 0.3; cursor: default; }
	.btn-link {
		background: none; border: none; color: var(--text-secondary); font-size: 0.85rem;
		cursor: pointer; padding: 8px; text-align: center;
	}
	.btn-link:hover { color: var(--accent); }
	.confirm-row {
		display: flex; align-items: center; gap: 8px; margin-bottom: 20px;
		color: var(--text-secondary); cursor: pointer; font-size: 0.9rem;
	}
	.confirm-row input { accent-color: var(--accent); }
	.name-input { font-size: 1.2rem; padding: 14px 16px; margin-bottom: 24px; text-align: center; }
	.topics-preview { margin-bottom: 28px; }
	.topics-label { color: var(--text-tertiary); font-size: 0.8rem; margin-bottom: 10px; }
	.topic-pills { display: flex; flex-wrap: wrap; gap: 6px; }
	.topic-pill {
		padding: 4px 12px; border-radius: 20px; font-size: 0.8rem;
		background: rgba(249,115,22,0.08); border: 1px solid rgba(249,115,22,0.15);
		color: var(--accent);
	}
	.error { color: #f87171; font-size: 0.85rem; margin-bottom: 12px; }
	textarea { resize: vertical; min-height: 80px; margin-bottom: 12px; }
</style>
