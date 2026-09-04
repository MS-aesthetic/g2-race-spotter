// @vitest-environment jsdom
import { MSG_MAX_CHARS, type State } from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { createModel, type Model } from '../src/model.ts';
import { createRenderer } from '../src/ui/vdom.ts';
import { view } from '../src/ui/view.ts';

function stateWith(overrides: Partial<State> = {}): State {
  return {
    t: 'state',
    seq: 1,
    lane: null,
    gap: 0,
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000,
    ...overrides,
  };
}

function consoleModel(overrides: Partial<Model> = {}): Model {
  return createModel({
    screen: 'console',
    form: { room: 'CAR42', pin: '', name: 'Sam' },
    conn: 'open',
    state: stateWith(),
    now: 5_000,
    latencyMs: 180,
    latencyAt: 5_000,
    ...overrides,
  });
}

let root: HTMLElement;
let render: (model: Model) => void;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById('app')!;
  const paint = createRenderer(root);
  render = (model: Model) => paint(view(model));
});

function text(selector: string): string {
  return root.querySelector(selector)?.textContent ?? '';
}

/** The banner slot is always in the DOM (so the positional diff never shifts
 * siblings); "present" means present *and* not hidden. */
function banner(): Element | null {
  const el = root.querySelector('[data-testid="reconnect-banner"]');
  return el === null || el.hasAttribute('hidden') ? null : el;
}

describe('AC-1 lane selection and driver status', () => {
  it('highlights only the middle lane for lane:"mid"', () => {
    render(consoleModel({ state: stateWith({ lane: 'mid' }) }));

    const selected = root.querySelectorAll('.lane.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute('data-lane')).toBe('mid');
    expect(selected[0]!.getAttribute('aria-pressed')).toBe('true');
    // All three lanes are still rendered, in glasses order.
    expect(
      [...root.querySelectorAll('.lane')].map((el) =>
        el.getAttribute('data-lane'),
      ),
    ).toEqual(['top', 'mid', 'bot']);
  });

  it('highlights nothing when the room has no lane', () => {
    render(consoleModel({ state: stateWith({ lane: null }) }));

    expect(root.querySelectorAll('.lane.is-selected')).toHaveLength(0);
  });

  it('shows DRIVER ONLINE / DRIVER OFFLINE per driverOnline', () => {
    render(consoleModel({ state: stateWith({ driverOnline: true }) }));
    expect(text('[data-testid="header-driver"]')).toBe('DRIVER ONLINE');
    expect(root.querySelector('.header')!.className).not.toContain(
      'header--offline',
    );

    render(consoleModel({ state: stateWith({ driverOnline: false }) }));
    expect(text('[data-testid="header-driver"]')).toBe('DRIVER OFFLINE');
    // Amber header is the "driver is not receiving you" signal.
    expect(root.querySelector('.header')!.className).toContain(
      'header--offline',
    );
  });

  it('shows the room code and the EWMA latency in the header', () => {
    render(consoleModel({ latencyMs: 180, latencyAt: 5_000, now: 5_000 }));

    expect(text('[data-testid="header-room"]')).toBe('ROOM CAR42');
    expect(text('[data-testid="header-latency"]')).toBe('180 ms');
    expect(
      root.querySelector('[data-testid="header-latency"]')!.className,
    ).not.toContain('is-stale');
  });

  it('greys a latency sample older than 10 s', () => {
    render(consoleModel({ latencyMs: 180, latencyAt: 5_000, now: 20_000 }));

    expect(
      root.querySelector('[data-testid="header-latency"]')!.className,
    ).toContain('is-stale');
  });
});

describe('AC-3 reconnect banner', () => {
  it('shows the banner with controls still enabled when the socket is closed', () => {
    render(consoleModel({ conn: 'closed', state: null }));

    const shown = banner();
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toBe('RECONNECTING');
    expect(root.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect(root.querySelectorAll('input[disabled]')).toHaveLength(0);
    expect(root.querySelectorAll('.lane')).toHaveLength(3);
    expect(root.querySelector('.header')!.className).toContain('header--down');
  });

  it('keeps the banner while open but not yet replayed', () => {
    render(consoleModel({ conn: 'open', state: null }));

    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toBe('SYNCING…');
  });

  it('drops the banner and reconciles to the replayed state on reopen', () => {
    // Same renderer across both frames: this is the real patch path, not a
    // fresh mount, so a stale highlight would survive if reconciliation broke.
    render(consoleModel({ conn: 'closed', state: null, gap: 0 }));
    render(
      consoleModel({
        conn: 'open',
        state: stateWith({ seq: 9, lane: 'bot', gap: 80 }),
        gap: 80,
      }),
    );

    expect(banner()).toBeNull();
    const selected = root.querySelectorAll('.lane.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute('data-lane')).toBe('bot');
    expect(text('[data-testid="gap-value"]')).toBe('80');
    expect(
      (root.querySelector('[data-testid="gap-range"]') as HTMLInputElement)
        .value,
    ).toBe('80');
    expect(root.querySelector('.gap')!.className).toContain('is-hot');
    expect(root.querySelectorAll('button[disabled]')).toHaveLength(0);
  });
});

describe('banner toggling never re-creates the controls', () => {
  it('keeps the same slider and message input across hide and show', () => {
    render(consoleModel({ conn: 'closed', state: null }));
    const rangeWhileDown = root.querySelector('[data-testid="gap-range"]');
    const inputWhileDown = root.querySelector('[data-testid="msg-input"]');
    expect(rangeWhileDown).not.toBeNull();

    // Socket recovers and the room replays: the banner hides, but a drag or a
    // half-typed message in flight must survive it.
    render(consoleModel({ conn: 'open', state: stateWith({ seq: 4 }) }));
    expect(banner()).toBeNull();
    expect(root.querySelector('[data-testid="gap-range"]')).toBe(
      rangeWhileDown,
    );
    expect(root.querySelector('[data-testid="msg-input"]')).toBe(
      inputWhileDown,
    );

    // And back again when it drops.
    render(consoleModel({ conn: 'closed', state: null }));
    expect(banner()).not.toBeNull();
    expect(root.querySelector('[data-testid="gap-range"]')).toBe(
      rangeWhileDown,
    );
    expect(root.querySelector('[data-testid="msg-input"]')).toBe(
      inputWhileDown,
    );
  });

  it('keeps the lane buttons and the update toast slot stable', () => {
    render(consoleModel());
    const lanes = [...root.querySelectorAll('.lane')];
    const toast = root.querySelector('[data-testid="update-toast"]');
    expect(toast!.hasAttribute('hidden')).toBe(true);

    render(consoleModel({ updateReady: true, conn: 'closed', state: null }));

    expect([...root.querySelectorAll('.lane')]).toEqual(lanes);
    expect(root.querySelector('[data-testid="update-toast"]')).toBe(toast);
    expect(toast!.hasAttribute('hidden')).toBe(false);
  });
});

describe('AC-4 ack tick', () => {
  const message = {
    id: '01J',
    text: 'box this lap',
    ts: 4_000,
    ackedAt: null as number | null,
  };

  it('shows "… waiting" while the message is unacknowledged', () => {
    render(consoleModel({ state: stateWith({ msg: { ...message } }) }));

    expect(text('[data-testid="header-ack"]')).toBe('… waiting');
  });

  it('shows the ack tick once ackedAt is non-null', () => {
    render(consoleModel({ state: stateWith({ msg: { ...message } }) }));
    render(
      consoleModel({
        state: stateWith({ seq: 2, msg: { ...message, ackedAt: 4_200 } }),
      }),
    );

    expect(text('[data-testid="header-ack"]')).toBe('✓ acked');
  });

  it('shows no ack element when the room holds no message', () => {
    render(consoleModel({ state: stateWith({ msg: null }) }));

    expect(root.querySelector('[data-testid="header-ack"]')).toBeNull();
  });
});

describe('console controls', () => {
  it('caps the message input at MSG_MAX_CHARS and offers Send/Clear', () => {
    render(consoleModel());

    const input = root.querySelector(
      '[data-testid="msg-input"]',
    ) as HTMLInputElement;
    expect(input.getAttribute('maxlength')).toBe(String(MSG_MAX_CHARS));
    expect(root.querySelector('[data-act="send"]')).not.toBeNull();
    expect(root.querySelector('[data-act="clear"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="lane-clear"]')).not.toBeNull();
  });

  it('renders the quick-set chips 0 · 25 · 50 · 75 · 100', () => {
    render(consoleModel());

    expect(
      [...root.querySelectorAll('[data-act="gap-chip"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['0', '25', '50', '75', '100']);
  });

  it('renders at most five recent-message chips', () => {
    render(consoleModel({ recent: ['a', 'b', 'c', 'd', 'e'] }));

    const chips = root.querySelectorAll('[data-act="recent"]');
    expect(chips).toHaveLength(5);
    expect(chips[0]!.getAttribute('data-arg')).toBe('a');
  });
});

describe('join screen', () => {
  it('shows the relay host and the stored form values', () => {
    render(
      createModel({
        screen: 'join',
        form: { room: 'CAR42', pin: '1234', name: 'Sam' },
        relayHost: 'wss://relay.example.com',
      }),
    );

    expect(text('[data-testid="join-host"]')).toBe(
      'relay wss://relay.example.com',
    );
    expect(
      (root.querySelector('[data-testid="join-room"]') as HTMLInputElement)
        .value,
    ).toBe('CAR42');
    const notice = root.querySelector('[data-testid="join-notice"]');
    expect(notice!.hasAttribute('hidden')).toBe(true);
  });

  it('shows the wrong-PIN notice after a terminal auth close', () => {
    render(
      createModel({
        screen: 'join',
        notice: 'Wrong PIN — check the code with the driver.',
      }),
    );

    const notice = root.querySelector('[data-testid="join-notice"]')!;
    expect(notice.hasAttribute('hidden')).toBe(false);
    expect(notice.textContent).toContain('Wrong PIN');
  });

  it('keeps the room field stable when a notice appears', () => {
    const form = { room: 'CAR42', pin: '', name: '' };
    render(createModel({ screen: 'join', form }));
    const roomField = root.querySelector('[data-testid="join-room"]');

    render(createModel({ screen: 'join', form, notice: 'Wrong PIN.' }));

    expect(root.querySelector('[data-testid="join-room"]')).toBe(roomField);
  });
});
