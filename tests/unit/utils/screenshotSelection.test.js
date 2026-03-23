import { describe, expect, it } from 'vitest';
import { selectMonitorForCapture, selectPrimaryMonitor } from '../../../utils/platform/screenshotSelection';

describe('screenshotSelection', () => {
  it('selectPrimaryMonitor prefers monitor marked as primary', () => {
    const monitors = [
      { id: 'left', isPrimary: false },
      { id: 'right', isPrimary: true },
    ];

    expect(selectPrimaryMonitor(monitors)?.id).toBe('right');
  });

  it('selectMonitorForCapture picks monitor containing overlay origin', () => {
    const monitors = [
      { id: 'left', x: -1920, y: 0, width: 1920, height: 1080, isPrimary: false },
      { id: 'right', x: 0, y: 0, width: 2560, height: 1440, isPrimary: true },
    ];

    const picked = selectMonitorForCapture(monitors, {
      screenX: -1200,
      screenY: 150,
      innerWidth: 1920,
      innerHeight: 1080,
      devicePixelRatio: 1,
    });

    expect(picked?.id).toBe('left');
  });

  it('selectMonitorForCapture falls back to primary when unsure', () => {
    const monitors = [
      { id: 'a', isPrimary: false },
      { id: 'b', isPrimary: true },
    ];

    const picked = selectMonitorForCapture(monitors, {
      screenX: null,
      screenY: null,
      innerWidth: null,
      innerHeight: null,
      devicePixelRatio: null,
    });

    expect(picked?.id).toBe('b');
  });
});
