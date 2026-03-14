<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { identityState } from '$lib/stores.svelte.js';

	let address = $derived($page.params.address);

	onMount(() => {
		// If already has identity, go straight to DM
		const check = setInterval(() => {
			if (identityState.identity) {
				clearInterval(check);
				sessionStorage.setItem('agora_dm_open', address);
				goto('/dm', { replaceState: true });
			} else {
				// Store for after setup
				sessionStorage.setItem('agora_join_address', address);
				goto('/setup', { replaceState: true });
			}
		}, 100);

		// Fallback after 3s — identity loading might be slow
		setTimeout(() => {
			clearInterval(check);
			if (identityState.identity) {
				sessionStorage.setItem('agora_dm_open', address);
				goto('/dm', { replaceState: true });
			} else {
				sessionStorage.setItem('agora_join_address', address);
				goto('/setup', { replaceState: true });
			}
		}, 3000);
	});
</script>

<div class="join">
	<p>Connecting you to <span class="mono accent">{address.slice(0, 16)}...</span></p>
</div>

<style>
	.join { text-align: center; margin-top: 120px; color: var(--text-secondary); }
	.accent { color: var(--accent); }
</style>
