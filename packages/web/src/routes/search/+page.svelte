<script lang="ts">
	import { feedState, appState } from '$lib/stores.svelte.js';
	import type { PostContent } from '@agora/core';
	import { page } from '$app/stores';

	let query = $state($page.url.searchParams.get('q') || '');
	let searched = $state(false);

	function displayName(key: string): string {
		return appState.profileManager?.displayName(key) || key.slice(0, 8) + '...';
	}

	function formatTime(ts: number): string {
		const diff = Date.now() - ts;
		if (diff < 60_000) return 'now';
		if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m`;
		if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h`;
		return new Date(ts).toLocaleDateString();
	}

	let results = $derived(() => {
		if (!query.trim()) return [];
		searched = true;
		const q = query.toLowerCase().trim();
		return feedState.objects
			.filter((o) => {
				if (o.body.type !== 'post') return false;
				const c = o.body.content as PostContent;
				return c.text?.toLowerCase().includes(q) || c.topic?.toLowerCase().includes(q);
			})
			.sort((a, b) => b.body.timestamp - a.body.timestamp)
			.slice(0, 50);
	});

	// Search people too
	let peopleResults = $derived(() => {
		if (!query.trim()) return [];
		const q = query.toLowerCase().trim();
		const profiles = appState.profileManager?.getAllProfiles() || [];
		return profiles.filter((p) =>
			p.name?.toLowerCase().includes(q) || p.publicKey.toLowerCase().includes(q)
		).slice(0, 10);
	});
</script>

<h2>Search</h2>

<div class="search-bar">
	<input class="input search-input" bind:value={query} placeholder="Search posts, topics, people..." autofocus />
</div>

{#if query.trim()}
	{#if peopleResults().length > 0}
		<h3 class="section-title">People</h3>
		<div class="people-results">
			{#each peopleResults() as person (person.publicKey)}
				<a href="/u/{encodeURIComponent(person.publicKey)}" class="person-result card">
					<div class="person-avatar">{person.publicKey.slice(0, 2)}</div>
					<div>
						<div class="person-name">{person.name || person.publicKey.slice(0, 12) + '...'}</div>
						{#if person.city || person.country}
							<div class="person-loc">{[person.city, person.country].filter(Boolean).join(', ')}</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if results().length > 0}
		<h3 class="section-title">Posts ({results().length})</h3>
		<div class="post-results">
			{#each results() as obj (obj.id)}
				{@const content = obj.body.content as PostContent}
				<a href="/post/{encodeURIComponent(obj.id)}" class="post-result card">
					<div class="post-header">
						<span class="author mono">{displayName(obj.body.author)}</span>
						{#if content.topic}
							<span class="topic">#{content.topic}</span>
						{/if}
						<span class="time">{formatTime(obj.body.timestamp)}</span>
					</div>
					<div class="post-text">{content.text}</div>
				</a>
			{/each}
		</div>
	{/if}

	{#if results().length === 0 && peopleResults().length === 0 && searched}
		<div class="empty"><p>No results for "{query}"</p></div>
	{/if}
{:else}
	<div class="empty"><p>Type to search posts, topics, and people.</p></div>
{/if}

<style>
	h2 { color: var(--text-primary); margin: 0 0 16px; font-size: 1.3rem; }
	h3.section-title {
		color: var(--text-secondary); font-size: 0.8rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em; margin: 24px 0 12px;
	}
	.search-bar { margin-bottom: 8px; }
	.search-input { font-size: 1rem; padding: 14px 16px; }
	.people-results { display: flex; flex-direction: column; gap: 6px; }
	.person-result {
		display: flex; align-items: center; gap: 12px; padding: 12px 14px;
		text-decoration: none; color: inherit; transition: all 0.2s;
	}
	.person-result:hover { border-color: var(--accent-border); }
	.person-avatar {
		width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
		background: var(--bg-raised); display: flex; align-items: center; justify-content: center;
		font-family: var(--font-mono); font-size: 0.7rem; color: var(--accent);
		border: 1px solid var(--accent-border);
	}
	.person-name { font-size: 0.85rem; color: var(--text-primary); }
	.person-loc { font-size: 0.7rem; color: var(--text-tertiary); }
	.post-results { display: flex; flex-direction: column; gap: 6px; }
	.post-result {
		display: block; padding: 12px 14px; text-decoration: none; color: inherit; transition: all 0.2s;
	}
	.post-result:hover { border-color: var(--accent-border); }
	.post-header { display: flex; gap: 8px; align-items: center; font-size: 0.8rem; margin-bottom: 6px; }
	.author { color: var(--accent); font-weight: 500; }
	.topic { color: var(--text-tertiary); font-size: 0.75rem; }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.85rem; color: var(--text-secondary); }
	.empty { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
