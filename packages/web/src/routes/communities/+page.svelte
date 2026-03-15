<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, feedState, identityState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';
	import type { Community } from '$lib/communities.js';

	let communities = $state<Community[]>([]);
	let loaded = $state(false);
	let showCreate = $state(false);
	let newName = $state('');
	let newDesc = $state('');

	onMount(() => {
		const check = setInterval(() => {
			const cm = appState.communityManager;
			if (cm) {
				clearInterval(check);
				cm.updateCounts(feedState.objects);
				communities = cm.getAllCommunities();
				loaded = true;

				cm.onChange(() => {
					cm.updateCounts(feedState.objects);
					communities = cm.getAllCommunities();
				});
			}
		}, 50);
		return () => clearInterval(check);
	});

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 8) + '...';
	}

	async function create() {
		const cm = appState.communityManager;
		if (!cm || !newName.trim()) return;
		await cm.createCommunity(newName, newDesc || undefined);
		newName = '';
		newDesc = '';
		showCreate = false;
	}

	// Merge: show all pre-defined topics + any claimed communities
	let allTopics = $derived(() => {
		const claimed = new Set(communities.map(c => c.name));
		const unclaimed = TOPICS.filter(t => !claimed.has(t.id)).map(t => ({
			name: t.id,
			label: t.label,
			description: t.description,
			claimed: false,
			community: null as Community | null,
		}));
		const claimedList = communities.map(c => ({
			name: c.name,
			label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
			description: c.description || '',
			claimed: true,
			community: c,
		}));
		// Merge: claimed first, then unclaimed
		return [...claimedList, ...unclaimed];
	});
</script>

<div class="header">
	<h2>Communities</h2>
	<button class="btn" onclick={() => { showCreate = !showCreate; }}>
		{showCreate ? 'Cancel' : '+ Create'}
	</button>
</div>

{#if showCreate}
	<div class="create-form card">
		<input class="input" bind:value={newName} placeholder="Community name (e.g. rust, philosophy)" />
		<input class="input" bind:value={newDesc} placeholder="Description (optional)" />
		<button class="btn" onclick={create} disabled={!newName.trim()}>Create Community</button>
		<p class="create-hint">You'll be the first moderator. Community names are first-come-first-served.</p>
	</div>
{/if}

<div class="community-list">
	{#each allTopics() as topic (topic.name)}
		<a href="/c/{topic.name}" class="community-card card">
			<div class="community-top">
				<h3 class="community-name">#{topic.name}</h3>
				{#if topic.claimed}
					<span class="badge badge-online">claimed</span>
				{/if}
			</div>
			{#if topic.description}
				<p class="community-desc">{topic.description}</p>
			{/if}
			{#if topic.community}
				<div class="community-stats">
					<span>{topic.community.postCount} posts</span>
					<span>{topic.community.memberCount} members</span>
					<span>by {displayName(topic.community.creator)}</span>
				</div>
			{/if}
		</a>
	{/each}
</div>

{#if !loaded}
	<div class="loading">Loading communities...</div>
{/if}

<style>
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
	h2 { color: var(--text-primary); margin: 0; font-size: 1.3rem; }
	.create-form { margin-bottom: 20px; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
	.create-hint { color: var(--text-tertiary); font-size: 0.75rem; margin: 0; }
	.community-list { display: flex; flex-direction: column; gap: 8px; }
	.community-card {
		display: block; padding: 16px 18px; text-decoration: none; color: inherit;
		transition: all 0.2s; cursor: pointer;
	}
	.community-card:hover { border-color: var(--accent-border); box-shadow: 0 0 20px var(--accent-glow); }
	.community-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
	.community-name { margin: 0; font-size: 1rem; color: var(--accent); font-weight: 600; }
	.community-desc { color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 8px; line-height: 1.5; }
	.community-stats {
		display: flex; gap: 16px; font-size: 0.75rem; color: var(--text-tertiary);
	}
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
