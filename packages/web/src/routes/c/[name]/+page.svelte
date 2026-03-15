<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createObject, type PostContent, type SignedObject } from '@agora/core';
	import { identityState, feedState, addToFeed, appState } from '$lib/stores.svelte.js';
	import Markdown from '$lib/Markdown.svelte';

	let name = $derived($page.params.name);
	let composeText = $state('');
	let loaded = $state(false);
	let showHidden = $state(false);

	onMount(() => {
		const check = setInterval(async () => {
			const fm = appState.feedManager;
			if (fm) {
				clearInterval(check);
				fm.onObject((obj) => {
					if (obj.body.type === 'post' && (obj.body.content as PostContent).topic === name) {
						addToFeed(obj);
					}
				});
				await fm.subscribe(`community:${name}`, [{ types: ['post'], topics: [name] }]);
				loaded = true;
			}
		}, 50);
		return () => clearInterval(check);
	});

	let community = $derived(appState.communityManager?.getCommunity(name));
	let isMod = $derived(appState.communityManager?.isModerator(name) || false);
	let pinnedIds = $derived(appState.communityManager?.getPinnedIds(name) || []);

	let topicPosts = $derived(
		feedState.objects.filter((o) => {
			if (o.body.type !== 'post') return false;
			const c = o.body.content as PostContent;
			if (c.topic !== name || c.reply) return false;
			if (!showHidden && appState.communityManager?.isHidden(o.id)) return false;
			if (appState.communityManager?.isBanned(name, o.body.author)) return false;
			return true;
		})
	);

	let pinnedPosts = $derived(
		pinnedIds.map(id => feedState.objects.find(o => o.id === id)).filter(Boolean) as SignedObject[]
	);

	let regularPosts = $derived(
		topicPosts.filter(o => !pinnedIds.includes(o.id))
	);

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

	function replyCount(postId: string): number {
		return feedState.objects.filter((o) =>
			o.body.type === 'post' && (o.body.content as PostContent).reply === postId
		).length;
	}

	function post() {
		const identity = identityState.identity;
		const fm = appState.feedManager;
		if (!identity || !fm || !composeText.trim()) return;
		if (appState.communityManager?.isBanned(name, identity.publicKeyBase64)) return;

		const state = fm.getAuthorState(identity.publicKeyBase64);
		const obj = createObject({
			author: identity.publicKeyBase64,
			privateKey: identity.privateKey,
			type: 'post',
			content: { text: composeText.trim(), topic: name } as PostContent,
			seq: state.seq + 1,
			prev: state.lastId,
		});
		addToFeed(obj);
		fm.publish(obj);
		composeText = '';
	}

	async function handleMod(objectId: string, action: 'hide' | 'unhide' | 'pin' | 'unpin') {
		await appState.communityManager?.moderate(name, objectId, action);
	}

	async function handleBan(pubkey: string) {
		await appState.communityManager?.moderate(name, pubkey, 'ban');
	}

	async function claimCommunity() {
		await appState.communityManager?.createCommunity(name);
	}

	let isHiddenObj = (id: string) => appState.communityManager?.isHidden(id) || false;
	let isPinned = (id: string) => pinnedIds.includes(id);
</script>

<div class="community-header card">
	<div class="header-top">
		<h2><span class="hash">#</span>{name}</h2>
		<button class="follow-btn" class:following={appState.moderation?.isFollowingCommunity(name)}
			onclick={() => {
				const mod = appState.moderation;
				if (!mod) return;
				if (mod.isFollowingCommunity(name)) mod.unfollowCommunity(name);
				else mod.followCommunity(name);
			}}>
			{appState.moderation?.isFollowingCommunity(name) ? 'Following' : 'Follow'}
		</button>
	</div>
	{#if community?.description}
		<p class="community-desc">{community.description}</p>
	{/if}
	{#if community}
		<div class="community-meta">
			<span>Created by {displayName(community.creator)}</span>
			<span>{community.moderators.length} mod{community.moderators.length > 1 ? 's' : ''}</span>
		</div>
	{:else}
		<div class="unclaimed">
			<p>This topic isn't claimed as a community yet.</p>
			<button class="btn btn-secondary" onclick={claimCommunity}>Claim #{name}</button>
		</div>
	{/if}
	{#if isMod}
		<div class="mod-tools">
			<span class="mod-badge">Moderator</span>
			<label class="toggle-hidden">
				<input type="checkbox" bind:checked={showHidden} />
				Show hidden posts
			</label>
		</div>
	{/if}
</div>

<div class="compose card">
	<textarea class="input" bind:value={composeText} placeholder="Post to #{name}..." rows="2"
		onkeydown={(e) => { if (e.key === 'Enter' && e.metaKey) post(); }}
	></textarea>
	<div class="compose-bar">
		<span class="compose-topic">#{name}</span>
		<button class="btn" onclick={post} disabled={!composeText.trim()}>Post</button>
	</div>
</div>

{#if pinnedPosts.length > 0}
	<h3 class="section-label">Pinned</h3>
	<div class="feed">
		{#each pinnedPosts as obj (obj.id)}
			{@const content = obj.body.content as PostContent}
			<div class="post card pinned">
				<div class="pin-badge">Pinned</div>
				<div class="post-header">
					<a href="/u/{encodeURIComponent(obj.body.author)}" class="author mono"
						onclick={(e) => e.stopPropagation()}>{displayName(obj.body.author)}</a>
					<span class="time">{formatTime(obj.body.timestamp)}</span>
				</div>
				<div class="post-text"><Markdown text={content.text} /></div>
				{#if isMod}
					<div class="mod-actions">
						<button class="mod-btn" onclick={() => handleMod(obj.id, 'unpin')}>Unpin</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<div class="feed">
	{#each regularPosts as obj (obj.id)}
		{@const content = obj.body.content as PostContent}
		{@const replies = replyCount(obj.id)}
		{@const hidden = isHiddenObj(obj.id)}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="post card" class:hidden-post={hidden}
			onclick={() => window.location.href = `/post/${encodeURIComponent(obj.id)}`}>
			{#if hidden}
				<div class="hidden-label">Hidden by moderator</div>
			{/if}
			<div class="post-header">
				<a href="/u/{encodeURIComponent(obj.body.author)}" class="author mono"
					onclick={(e) => e.stopPropagation()}>{displayName(obj.body.author)}</a>
				<span class="time">{formatTime(obj.body.timestamp)}</span>
			</div>
			<div class="post-text"><Markdown text={content.text} /></div>
			{#if content.image}
				<div class="post-image"><img src={content.image} alt="" /></div>
			{/if}
			<div class="post-footer">
				{#if replies > 0}
					<span class="reply-count">{replies} {replies === 1 ? 'reply' : 'replies'}</span>
				{/if}
				{#if isMod}
					<div class="mod-actions" onclick={(e) => e.stopPropagation()}>
						{#if !hidden}
							<button class="mod-btn" onclick={() => handleMod(obj.id, 'hide')}>Hide</button>
						{:else}
							<button class="mod-btn" onclick={() => handleMod(obj.id, 'unhide')}>Unhide</button>
						{/if}
						{#if !isPinned(obj.id)}
							<button class="mod-btn" onclick={() => handleMod(obj.id, 'pin')}>Pin</button>
						{/if}
						<button class="mod-btn danger" onclick={() => handleBan(obj.body.author)}>Ban user</button>
					</div>
				{/if}
			</div>
		</div>
	{/each}
	{#if regularPosts.length === 0 && loaded}
		<div class="empty"><p>No posts in #{name} yet. Be the first.</p></div>
	{/if}
</div>

<style>
	.community-header { padding: 20px; margin-bottom: 16px; }
	.header-top { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
	h2 { margin: 0; font-size: 1.3rem; color: var(--text-primary); }
	.hash { color: var(--accent); }
	.follow-btn {
		background: var(--bg-input); border: 1px solid rgba(255,255,255,0.06);
		color: var(--text-secondary); padding: 5px 14px; border-radius: 20px;
		font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: all 0.2s;
	}
	.follow-btn:hover { border-color: var(--accent); color: var(--accent); }
	.follow-btn.following { background: rgba(249,115,22,0.1); border-color: var(--accent); color: var(--accent); }
	.community-desc { color: var(--text-secondary); font-size: 0.9rem; margin: 0 0 8px; line-height: 1.5; }
	.community-meta { display: flex; gap: 16px; font-size: 0.75rem; color: var(--text-tertiary); }
	.unclaimed { margin-top: 8px; }
	.unclaimed p { color: var(--text-tertiary); font-size: 0.85rem; margin-bottom: 8px; }
	.mod-tools {
		display: flex; align-items: center; gap: 12px; margin-top: 12px;
		padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.04);
	}
	.mod-badge {
		font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
		color: var(--accent); background: rgba(249,115,22,0.1);
		padding: 2px 8px; border-radius: 4px;
	}
	.toggle-hidden {
		display: flex; align-items: center; gap: 6px;
		font-size: 0.8rem; color: var(--text-secondary); cursor: pointer;
	}
	.toggle-hidden input { accent-color: var(--accent); }
	.compose { margin-bottom: 16px; }
	.compose textarea { resize: vertical; min-height: 50px; background: var(--bg-input); }
	.compose-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
	.compose-topic { color: var(--text-tertiary); font-size: 0.8rem; }
	.section-label {
		color: var(--text-secondary); font-size: 0.75rem; font-weight: 600;
		text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px;
	}
	.feed { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
	.post { padding: 14px 16px; cursor: pointer; transition: all 0.2s; }
	.post:hover { border-color: var(--accent-border); }
	.post.pinned { border-color: rgba(249,115,22,0.2); }
	.pin-badge {
		font-size: 0.65rem; font-weight: 600; text-transform: uppercase;
		color: var(--accent); margin-bottom: 6px;
	}
	.hidden-post { opacity: 0.5; }
	.hidden-label { font-size: 0.7rem; color: #f87171; margin-bottom: 6px; }
	.post-header { display: flex; gap: 10px; align-items: center; font-size: 0.8rem; margin-bottom: 8px; }
	.author { color: var(--accent); font-size: 0.8rem; font-weight: 500; }
	.author:hover { color: var(--accent-hover); }
	.time { color: var(--text-tertiary); margin-left: auto; font-size: 0.75rem; }
	.post-text { white-space: pre-wrap; line-height: 1.5; font-size: 0.9rem; }
	.post-image { margin-top: 10px; }
	.post-image img { max-width: 100%; max-height: 300px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); }
	.post-footer { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
	.reply-count { color: var(--text-secondary); font-size: 0.75rem; padding: 2px 8px; background: var(--bg-input); border-radius: 10px; }
	.mod-actions { display: flex; gap: 6px; margin-left: auto; }
	.mod-btn {
		background: var(--bg-input); border: 1px solid rgba(255,255,255,0.06);
		color: var(--text-secondary); font-size: 0.7rem; padding: 3px 8px;
		border-radius: 4px; cursor: pointer; transition: all 0.15s;
	}
	.mod-btn:hover { border-color: var(--accent-border); color: var(--accent); }
	.mod-btn.danger:hover { border-color: rgba(239,68,68,0.3); color: #f87171; }
	.empty { text-align: center; margin-top: 48px; color: var(--text-tertiary); }
</style>
