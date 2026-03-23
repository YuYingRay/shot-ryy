// Lightweight buffered Tauri event helper.
// Used to avoid dropping early app-emitted events before React registers listeners.

export function createBufferedTauriEvent(listen, eventName, { maxBuffer = 10 } = {}) {
	const subscribers = new Set();
	const buffer = [];
	let started = false;
	let unlisten = null;

	const start = () => {
		if (started) return;
		started = true;
		if (typeof listen !== 'function') return;

		listen(eventName, (event) => {
			const payload = event?.payload;
			if (subscribers.size === 0) {
				buffer.push(payload);
				if (buffer.length > maxBuffer) buffer.shift();
				return;
			}
			for (const cb of subscribers) {
				try {
					cb(payload);
				} catch {}
			}
		})
			.then((fn) => {
				unlisten = fn;
			})
			.catch(() => {});
	};

	// Start immediately so we can buffer events that arrive before subscribers.
	start();

	const subscribe = (cb) => {
		if (typeof cb !== 'function') return () => {};
		subscribers.add(cb);

		if (buffer.length) {
			const queued = buffer.splice(0, buffer.length);
			for (const payload of queued) {
				try {
					cb(payload);
				} catch {}
			}
		}

		return () => {
			try {
				subscribers.delete(cb);
			} catch {}
		};
	};

	const stop = () => {
		try {
			unlisten && unlisten();
		} catch {}
		unlisten = null;
	};

	return Object.freeze({ subscribe, stop });
}
