// Read stats from chrome.storage.local (written by background.js)
chrome.storage.local.get('agora_stats', function(data) {
  var stats = data.agora_stats;

  var badge = document.getElementById('badge');
  var v1 = document.getElementById('v1');
  var v2 = document.getElementById('v2');

  if (!stats) {
    badge.textContent = 'starting';
    return;
  }

  v1.textContent = (stats.relayObjects || stats.objectCount || 0).toLocaleString();
  v2.textContent = (stats.connectedRelays || 0) + '/' + (stats.totalRelays || 2);

  if (stats.connectedRelays > 0) {
    badge.textContent = 'live';
    badge.className = 'badge on';
  } else {
    badge.textContent = 'offline';
    badge.className = 'badge off';
  }
});
