// Makes Companion installable and nothing more. It has no install or cache step and answers no request itself:
// every fetch goes to the network as it would without a worker, so the API, /ws and signed-in pages are never stored.
// There is no offline editing.
self.addEventListener('fetch', () => {});
