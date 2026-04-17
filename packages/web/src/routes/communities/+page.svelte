<script lang="ts">
	import { onMount } from 'svelte';
	import { appState, feedState, identityState } from '$lib/stores.svelte.js';
	import { TOPICS } from '$lib/topics.js';
	import type { Community } from '$lib/communities.js';
	import type { PostContent } from '@agora/core';

	let communities = $state<Community[]>([]);
	let loaded = $state(false);
	let showCreate = $state(false);
	let newName = $state('');
	let newDesc = $state('');

	onMount(() => {
		const check = setInterval(async () => {
			const cm = appState.communityManager;
			const fm = appState.feedManager;
			if (cm && fm) {
				clearInterval(check);

				// Posts come via P2P gossip

				const refresh = () => {
					cm.updateCounts(feedState.objects);
					communities = cm.getAllCommunities();
				};

				cm.onChange(refresh);
				fm.onObject(refresh);
				refresh();
				loaded = true;
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

	function isFollowing(name: string): boolean {
		return appState.moderation?.isFollowingCommunity(name) || false;
	}

	function toggleFollow(e: Event, name: string) {
		e.preventDefault();
		e.stopPropagation();
		const mod = appState.moderation;
		if (!mod) return;
		if (mod.isFollowingCommunity(name)) mod.unfollowCommunity(name);
		else mod.followCommunity(name);
	}

	// Count posts per topic from feed state
	function postCount(topic: string): number {
		return feedState.objects.filter(o =>
			o.body.type === 'post' && (o.body.content as PostContent).topic === topic
		).length;
	}

	// All topics: claimed communities + unclaimed seed topics + user-created from posts
	let allTopics = $derived(() => {
		const claimed = new Map(communities.map(c => [c.name, c]));
		const seen = new Set([...claimed.keys(), ...TOPICS.map(t => t.id)]);

		// Discover topics from posts
		for (const obj of feedState.objects) {
			if (obj.body.type === 'post') {
				const t = (obj.body.content as PostContent).topic;
				if (t && !seen.has(t)) seen.add(t);
			}
		}

		const result: Array<{
			name: string; description: string; community: Community | null;
			posts: number; following: boolean;
		}> = [];

		for (const name of seen) {
			const c = claimed.get(name);
			const seed = TOPICS.find(t => t.id === name);
			result.push({
				name,
				description: c?.description || seed?.description || '',
				community: c || null,
				posts: postCount(name),
				following: isFollowing(name),
			});
		}

		// Sort: following first, then by post count
		return result.sort((a, b) => {
			if (a.following !== b.following) return a.following ? -1 : 1;
			return b.posts - a.posts;
		});
	});
</script>

<div class="header">
	<h2>Communities</h2>
	<button class="btn" onclick={() => { showCreate = !showCreate; }}>
		{showCreate ? 'Cancel' : '+ Create'}
	</button>
</div>

<p class="page-desc">Follow communities to build your personal feed. Create new ones for any topic.</p>

{#if showCreate}
	<div class="create-form card">
		<input class="input" bind:value={newName} placeholder="Community name (e.g. rust, philosophy)" />
		<input class="input" bind:value={newDesc} placeholder="Description (optional)" />
		<button class="btn" onclick={create} disabled={!newName.trim()}>Create Community</button>
	</div>
{/if}

<div class="community-list">
	{#each allTopics() as topic (topic.name)}
		<a href="/c/{topic.name}" class="community-card card">
			<div class="community-left">
				<div class="community-top">
					<h3 class="community-name">#{topic.name}</h3>
					{#if topic.community}
						<span class="badge badge-online" style="font-size:0.65rem">mod</span>
					{/if}
				</div>
				{#if topic.description}
					<p class="community-desc">{topic.description}</p>
				{/if}
				<div class="community-stats">
					<span>{topic.posts} posts</span>
					{#if topic.community}
						<span>by {displayName(topic.community.creator)}</span>
					{/if}
				</div>
			</div>
			<button class="follow-btn" class:following={topic.following}
				onclick={(e) => toggleFollow(e, topic.name)}>
				{topic.following ? 'Following' : 'Follow'}
			</button>
		</a>
	{/each}
</div>

{#if !loaded}
	<div class="loading">Loading...</div>
{/if}

<style>
	.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
	h2 { color: var(--text-primary); margin: 0; font-size: 1.3rem; }
	.page-desc { color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 20px; }
	.create-form { margin-bottom: 16px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
	.community-list { display: flex; flex-direction: column; gap: 8px; }
	.community-card {
		display: flex; justify-content: space-between; align-items: center;
		padding: 16px 18px; text-decoration: none; color: inherit;
		transition: all 0.2s; cursor: pointer;
	}
	.community-card:hover { border-color: var(--accent-border); }
	.community-left { flex: 1; min-width: 0; }
	.community-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
	.community-name { margin: 0; font-size: 1rem; color: var(--accent); font-weight: 600; }
	.community-desc { color: var(--text-secondary); font-size: 0.8rem; margin: 0 0 6px; line-height: 1.4; }
	.community-stats { display: flex; gap: 12px; font-size: 0.7rem; color: var(--text-tertiary); }
	.follow-btn {
		flex-shrink: 0; background: var(--bg-input); border: 1px solid rgba(255,255,255,0.06);
		color: var(--text-secondary); padding: 6px 16px; border-radius: 20px;
		font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
	}
	.follow-btn:hover { border-color: var(--accent); color: var(--accent); }
	.follow-btn.following {
		background: rgba(249,115,22,0.1); border-color: var(--accent); color: var(--accent);
	}
	.loading { text-align: center; margin-top: 64px; color: var(--text-tertiary); }
</style>
