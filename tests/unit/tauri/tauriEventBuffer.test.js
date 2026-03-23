import { describe, expect, it } from 'vitest';
import { createBufferedTauriEvent } from '../../../utils/platform/tauriEventBuffer';

describe('createBufferedTauriEvent', () => {
	it('buffers events until a subscriber attaches, then flushes', async () => {
		let handler = null;
		const listen = async (_name, cb) => {
			handler = cb;
			return () => {};
		};

		const bus = createBufferedTauriEvent(listen, 'screenshot-captured', { maxBuffer: 3 });

		handler?.({ payload: { a: 1 } });
		handler?.({ payload: { a: 2 } });

		const received = [];
		bus.subscribe((p) => received.push(p));

		expect(received).toEqual([{ a: 1 }, { a: 2 }]);
	});

	it('caps the buffer size', async () => {
		let handler = null;
		const listen = async (_name, cb) => {
			handler = cb;
			return () => {};
		};

		const bus = createBufferedTauriEvent(listen, 'screenshot-captured', { maxBuffer: 2 });

		handler?.({ payload: 1 });
		handler?.({ payload: 2 });
		handler?.({ payload: 3 });

		const received = [];
		bus.subscribe((p) => received.push(p));

		expect(received).toEqual([2, 3]);
	});

	it('delivers live events to subscribers', async () => {
		let handler = null;
		const listen = async (_name, cb) => {
			handler = cb;
			return () => {};
		};

		const bus = createBufferedTauriEvent(listen, 'screenshot-captured', { maxBuffer: 2 });

		const received = [];
		bus.subscribe((p) => received.push(p));

		handler?.({ payload: { live: true } });
		expect(received).toEqual([{ live: true }]);
	});
});
