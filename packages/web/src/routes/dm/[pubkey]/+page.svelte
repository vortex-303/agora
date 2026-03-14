<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		// Store the target partner and redirect to the DM page
		const partner = $page.params.pubkey;
		if (partner) {
			sessionStorage.setItem('agora_dm_open', partner);
		}
		goto('/dm', { replaceState: true });
	});
</script>

<p>Redirecting...</p>
