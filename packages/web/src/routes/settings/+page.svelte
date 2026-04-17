<script lang="ts">
	import { onMount } from 'svelte';
	import { createObject, type ProfileContent } from '@agora/core';
	import { identityState, appState } from '$lib/stores.svelte.js';
	import { clearIdentity } from '$lib/identity.js';

	let username = $state('');
	let bio = $state('');
	let saved = $state(false);
	let copied = $state(false);

	// Concierge fields
	let availability = $state('');
	let services = $state('');
	let preferredContact = $state('');
	let links = $state<Array<{ label: string; url: string }>>([]);
	let newLinkLabel = $state('');
	let newLinkUrl = $state('');
	let faqs = $state<Array<{ q: string; a: string }>>([]);
	let newFaqQ = $state('');
	let newFaqA = $state('');

	const CONCIERGE_KEY = 'riot_concierge_profile';

	onMount(() => {
		try {
			const c = localStorage.getItem(CONCIERGE_KEY);
			if (c) {
				const data = JSON.parse(c);
				availability = data.availability || '';
				services = data.services || '';
				preferredContact = data.preferredContact || '';
				links = data.links || [];
				faqs = data.faqs || [];
			}
		} catch {}

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

	function saveConcierge() {
		localStorage.setItem(CONCIERGE_KEY, JSON.stringify({
			availability, services, preferredContact, links, faqs,
		}));
		appState.accountSync?.updateSettings({
			concierge: { availability, services, preferredContact, links, faqs },
		});
	}

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
		saveConcierge();
		saved = true;
		setTimeout(() => { saved = false; }, 2000);
	}

	function addLink() {
		if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
		links = [...links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }];
		newLinkLabel = '';
		newLinkUrl = '';
		saveConcierge();
	}

	function removeLink(i: number) {
		links = links.filter((_, idx) => idx !== i);
		saveConcierge();
	}

	function addFaq() {
		if (!newFaqQ.trim() || !newFaqA.trim()) return;
		faqs = [...faqs, { q: newFaqQ.trim(), a: newFaqA.trim() }];
		newFaqQ = '';
		newFaqA = '';
		saveConcierge();
	}

	function removeFaq(i: number) {
		faqs = faqs.filter((_, idx) => idx !== i);
		saveConcierge();
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
	<!-- Profile -->
	<div class="section card">
		<h3 class="section-title">Profile</h3>
		<label class="field">
			<span class="field-label">Display Name</span>
			<input class="input" bind:value={username} placeholder="Anonymous" />
			<span class="field-hint">Your Riot Link: riotp2p.com/{(username.toLowerCase().replace(/\s+/g, '') || 'yourname') + '.' + (identityState.identity?.publicKeyBase64.slice(0, 6) || '')}</span>
			<span class="field-hint">The suffix makes your link unique — even if others pick the same name.</span>
		</label>
		<label class="field">
			<span class="field-label">Bio</span>
			<input class="input" bind:value={bio} placeholder="What do you do? Who are you?" />
		</label>
		<button class="btn" onclick={saveProfile}>
			{saved ? 'Saved!' : 'Save Profile'}
		</button>
	</div>

	<!-- Concierge Info -->
	<div class="section card">
		<h3 class="section-title">Concierge Info</h3>
		<p class="section-hint">Optional. This information helps visitors (and your future AI concierge) know more about you.</p>

		<label class="field">
			<span class="field-label">Availability / Schedule</span>
			<input class="input" bind:value={availability} placeholder="Mon-Fri 9-5 EST, flexible weekends"
				onblur={saveConcierge} />
		</label>

		<label class="field">
			<span class="field-label">Services / Rates</span>
			<input class="input" bind:value={services} placeholder="Full-stack development, $150/hr"
				onblur={saveConcierge} />
		</label>

		<label class="field">
			<span class="field-label">Preferred Contact Method</span>
			<input class="input" bind:value={preferredContact} placeholder="For urgent: email me at you@example.com"
				onblur={saveConcierge} />
		</label>
	</div>

	<!-- Links -->
	<div class="section card">
		<h3 class="section-title">Links</h3>
		<p class="section-hint">Portfolio, GitHub, social profiles, calendar — anything you want visitors to find.</p>

		{#if links.length > 0}
			<div class="item-list">
				{#each links as link, i (i)}
					<div class="item-row">
						<div class="item-content">
							<span class="item-label">{link.label}</span>
							<a href={link.url} target="_blank" class="item-url mono">{link.url}</a>
						</div>
						<button class="item-remove" onclick={() => removeLink(i)}>✕</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="add-row">
			<input class="input" style="flex:1" bind:value={newLinkLabel} placeholder="Label (e.g. Portfolio)" />
			<input class="input" style="flex:2" bind:value={newLinkUrl} placeholder="https://..." />
			<button class="btn btn-secondary btn-sm" onclick={addLink}>Add</button>
		</div>
	</div>

	<!-- FAQ -->
	<div class="section card">
		<h3 class="section-title">FAQ</h3>
		<p class="section-hint">Common questions and your answers. Your concierge uses these first before generating a response.</p>

		{#if faqs.length > 0}
			<div class="item-list">
				{#each faqs as faq, i (i)}
					<div class="faq-item">
						<div class="faq-q">Q: {faq.q}</div>
						<div class="faq-a">A: {faq.a}</div>
						<button class="item-remove" onclick={() => removeFaq(i)}>✕</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="add-col">
			<input class="input" bind:value={newFaqQ} placeholder="Question visitors might ask" />
			<input class="input" bind:value={newFaqA} placeholder="Your answer" />
			<button class="btn btn-secondary btn-sm" onclick={addFaq} disabled={!newFaqQ.trim() || !newFaqA.trim()}>Add FAQ</button>
		</div>
	</div>

	<!-- Identity -->
	<div class="section card">
		<h3 class="section-title">Identity</h3>
		<label class="field">
			<span class="field-label">Public address</span>
			<div class="address-row">
				<code class="mono address-text">{identityState.identity.publicKeyBase64}</code>
				<button class="btn btn-secondary btn-sm" onclick={copyAddress}>
					{copied ? 'Copied!' : 'Copy'}
				</button>
			</div>
		</label>
		<div class="mnemonic-warn">
			Your 12-word recovery phrase is the only way to recover this identity. It was shown during setup.
		</div>
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
		text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 6px;
	}
	.section { margin-bottom: 16px; padding: 18px; }
	.section-hint { color: var(--text-tertiary); font-size: 0.75rem; margin-bottom: 14px; line-height: 1.4; }
	.field { display: block; margin-bottom: 12px; }
	.field-label { display: block; color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 5px; }
	.field-hint { display: block; color: var(--text-tertiary); font-size: 0.7rem; margin-top: 4px; }

	.item-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
	.item-row {
		display: flex; justify-content: space-between; align-items: center;
		padding: 8px 12px; background: var(--bg-input); border-radius: 6px;
	}
	.item-content { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.item-label { font-size: 0.8rem; color: var(--text-primary); font-weight: 500; }
	.item-url { font-size: 0.7rem; color: var(--accent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.item-remove {
		background: none; border: none; color: var(--text-tertiary);
		cursor: pointer; font-size: 0.8rem; padding: 2px 6px; flex-shrink: 0;
	}
	.item-remove:hover { color: #f87171; }
	.item-remove:disabled { opacity: 0.2; }

	.faq-item {
		position: relative; padding: 10px 12px; background: var(--bg-input); border-radius: 6px;
	}
	.faq-q { font-size: 0.8rem; color: var(--text-primary); font-weight: 500; margin-bottom: 4px; }
	.faq-a { font-size: 0.8rem; color: var(--text-secondary); }
	.faq-item .item-remove { position: absolute; top: 8px; right: 8px; }

	.add-row { display: flex; gap: 6px; align-items: center; }
	.add-col { display: flex; flex-direction: column; gap: 6px; }
	.btn-sm { padding: 6px 14px; font-size: 0.75rem; }

	.address-row { display: flex; gap: 8px; align-items: center; }
	.address-text {
		flex: 1; font-size: 0.6rem; color: var(--accent);
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
		padding: 8px 10px; background: var(--bg-input); border-radius: 6px;
	}
	.mnemonic-warn { color: var(--text-tertiary); font-size: 0.8rem; line-height: 1.5; }
	.btn-danger {
		background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.2);
	}
	.btn-danger:hover { background: rgba(239,68,68,0.25); box-shadow: none; transform: none; }
	.warn-text { color: var(--text-tertiary); font-size: 0.75rem; margin-top: 8px; }
</style>
