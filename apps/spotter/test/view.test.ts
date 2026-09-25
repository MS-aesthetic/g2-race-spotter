// @vitest-environment jsdom
import {
  MSG_MAX_CHARS,
  PRESETS_MAX,
  type State,
} from '@g2-race-spotter/protocol';
import { beforeEach, describe, expect, it } from 'vitest';

import { createModel, type Model } from '../src/model.ts';
import { createRenderer } from '../src/ui/vdom.ts';
import { view } from '../src/ui/view.ts';

function stateWith(overrides: Partial<State> = {}): State {
  return {
    t: 'state',
    seq: 1,
    lane: null,
    cars: [0, 0, 0],
    msg: null,
    spotterOnline: true,
    driverOnline: true,
    updatedAt: 1_000,
    calledAt: 1_000,
    presets: [],
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

/** The RECONNECTING pill slot is always in the DOM (so the positional diff
 * never shifts siblings); "present" means present *and* not hidden. */
function banner(): Element | null {
  const el = root.querySelector('[data-testid="reconnect-pill"]');
  return el === null || el.hasAttribute('hidden') ? null : el;
}

function shown(selector: string): boolean {
  const el = root.querySelector(selector);
  return el !== null && !el.hasAttribute('hidden');
}

describe('AC-1 lane row and driver status (design round 4)', () => {
  it('lays the lanes out left to right as ▼ BOTTOM · ▬ MIDDLE · ▲ TOP', () => {
    render(consoleModel());

    const lanes = [...root.querySelectorAll('.lane')];
    expect(lanes.map((el) => el.getAttribute('data-lane'))).toEqual([
      'bot',
      'mid',
      'top',
    ]);
    expect(lanes.map((el) => el.textContent)).toEqual([
      '▼BOTTOM',
      '▬MIDDLE',
      '▲TOP',
    ]);
    // The clear control closes the row and sends lane:null.
    expect(
      root.querySelector('.lanes')!.lastElementChild!.getAttribute('data-act'),
    ).toBe('lane-clear');
  });

  it('highlights only the middle lane for lane:"mid"', () => {
    render(consoleModel({ state: stateWith({ lane: 'mid' }) }));

    const selected = root.querySelectorAll('.lane.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute('data-lane')).toBe('mid');
    expect(selected[0]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('highlights nothing when the room has no lane', () => {
    render(consoleModel({ state: stateWith({ lane: null }) }));

    expect(root.querySelectorAll('.lane.is-selected')).toHaveLength(0);
  });

  it('shows the driver dot green when online and grey when offline', () => {
    render(consoleModel({ state: stateWith({ driverOnline: true }) }));
    const dot = root.querySelector('[data-testid="header-driver"]')!;
    expect(dot.className).toContain('is-on');
    expect(dot.getAttribute('aria-label')).toBe('driver online');

    render(consoleModel({ state: stateWith({ driverOnline: false }) }));
    expect(dot.className).toContain('is-off');
    expect(dot.getAttribute('aria-label')).toBe('driver offline');
  });

  it('shows the room code as a chip and the EWMA latency in one header row', () => {
    render(consoleModel({ latencyMs: 180, latencyAt: 5_000, now: 5_000 }));

    expect(text('[data-testid="header-room"]')).toBe('CAR42');
    expect(text('[data-testid="header-latency"]')).toBe('180 ms');
    expect(
      root.querySelector('[data-testid="header-latency"]')!.className,
    ).not.toContain('is-stale');
    // Header, room chip, link dot, pill, driver dot, ack, latency: one row.
    expect(root.querySelector('.hdr')!.children).toHaveLength(6);
  });

  it('greys a latency sample older than 10 s', () => {
    render(consoleModel({ latencyMs: 180, latencyAt: 5_000, now: 20_000 }));

    expect(
      root.querySelector('[data-testid="header-latency"]')!.className,
    ).toContain('is-stale');
  });

  it('shows the room code large (with the PIN) for the driver when the chip is tapped', () => {
    const form = { room: 'QA01', pin: '4821', name: '' };
    render(consoleModel({ form }));
    expect(shown('[data-testid="code-overlay"]')).toBe(false);
    const overlay = root.querySelector('[data-testid="code-overlay"]');

    render(consoleModel({ form, showCode: true }));
    expect(shown('[data-testid="code-overlay"]')).toBe(true);
    expect(root.querySelector('[data-testid="code-overlay"]')).toBe(overlay);
    expect(text('.codeview__code')).toBe('QA01');
    expect(text('.codeview__pin')).toBe('PIN 4821');
    // The chip and the overlay both toggle it.
    expect(
      root
        .querySelector('[data-testid="header-room"]')!
        .getAttribute('data-act'),
    ).toBe('code');
    expect(overlay!.getAttribute('data-act')).toBe('code');
  });
});

/** `[slider][segment 1..3]` → is that segment lit? Read straight off the DOM. */
function litSegments(): boolean[][] {
  return [...root.querySelectorAll('.slider')].map((slider) =>
    [1, 2, 3].map((segment) =>
      slider
        .querySelector(`.seg[data-seg="${segment}"]`)!
        .classList.contains('is-lit'),
    ),
  );
}

describe('AC-2 vertical car sliders (design round 4)', () => {
  it('offers LEFT / MIDDLE / RIGHT sliders side by side, segments stacked bottom-up, under the lanes', () => {
    render(consoleModel());

    expect(
      [...root.querySelectorAll('.slider__label')].map((el) => el.textContent),
    ).toEqual(['LEFT', 'MIDDLE', 'RIGHT']);
    // DOM order is top to bottom: 3 on top, 1 at the bottom, label under it.
    expect(
      [...root.querySelectorAll('.slider')].map((slider) =>
        [...slider.children].map(
          (el) => el.getAttribute('data-arg') ?? el.className,
        ),
      ),
    ).toEqual([
      ['0:3', '0:2', '0:1', '0:0'],
      ['1:3', '1:2', '1:1', '1:0'],
      ['2:3', '2:2', '2:1', '2:0'],
    ]);
    expect(root.querySelectorAll('[data-act="car"]')).toHaveLength(9);
    expect(root.querySelectorAll('.seg.is-lit')).toHaveLength(0);
    // Top half: lanes then sliders; bottom half: messages.
    expect(
      [...root.querySelectorAll('.half--top > section')].map(
        (el) => el.className,
      ),
    ).toEqual(['lanes', 'sliders']);
    expect(
      [...root.querySelector('.half--bottom')!.children].map(
        (el) => el.className,
      ),
    ).toEqual(['says', 'presets', 'msg']);
  });

  it('lights segments 1..level of each slider from the room state, bottom up', () => {
    render(consoleModel({ state: stateWith({ cars: [1, 2, 3] }) }));

    expect(litSegments()).toEqual([
      [true, false, false],
      [true, true, false],
      [true, true, true],
    ]);
    // The lit top segment is marked: tapping it clears the slider.
    expect(
      [...root.querySelectorAll('.seg.is-top')].map((el) =>
        el.getAttribute('data-arg'),
      ),
    ).toEqual(['0:1', '1:2', '2:3']);
    expect(
      [...root.querySelectorAll('.slider')].map((el) =>
        el.getAttribute('data-level'),
      ),
    ).toEqual(['1', '2', '3']);
  });

  it('marks a level-3 slider hot, mirroring the glasses alert outline', () => {
    render(consoleModel({ state: stateWith({ cars: [3, 2, 0] }) }));

    const hot = [...root.querySelectorAll('.slider--hot')];
    expect(hot.map((el) => el.getAttribute('data-row'))).toEqual(['0']);
  });

  it('shows the finger while a slider is held, then the optimistic send, then the room', () => {
    // Held: the drag level wins over the room and over an old send.
    render(
      consoleModel({
        now: 5_100,
        state: stateWith({ cars: [0, 0, 0] }),
        dragCars: [0, 3, 0],
      }),
    );
    expect(litSegments()[1]).toEqual([true, true, true]);

    render(
      consoleModel({
        now: 5_100,
        state: stateWith({ cars: [0, 0, 0] }),
        optimisticCars: { cars: [0, 2, 0], at: 5_000 },
      }),
    );
    expect(litSegments()[1]).toEqual([true, true, false]);

    render(
      consoleModel({
        now: 5_400,
        state: stateWith({ cars: [0, 0, 0] }),
        optimisticCars: { cars: [0, 2, 0], at: 5_000 },
      }),
    );
    expect(root.querySelectorAll('.seg.is-lit')).toHaveLength(0);
  });

  it('keeps the segment buttons stable when the room state changes', () => {
    render(consoleModel());
    const segments = [...root.querySelectorAll('.seg')];

    render(consoleModel({ state: stateWith({ seq: 2, cars: [3, 3, 3] }) }));
    expect([...root.querySelectorAll('.seg')]).toEqual(segments);
    expect(root.querySelectorAll('.seg.is-lit')).toHaveLength(9);
  });
});

describe('AC-3 reconnect pill', () => {
  it('shows a small RECONNECTING pill and a red link dot, with controls still enabled, when the socket is closed', () => {
    render(consoleModel({ conn: 'closed', state: null }));

    const pill = banner();
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe('RECONNECTING');
    // In the header row, not a full-width bar of its own.
    expect(pill!.parentElement!.className).toBe('hdr');
    expect(
      root.querySelector('[data-testid="header-link"]')!.className,
    ).toContain('is-down');
    expect(root.querySelectorAll('button[disabled]')).toHaveLength(0);
    expect(root.querySelectorAll('input[disabled]')).toHaveLength(0);
    expect(root.querySelectorAll('.lane')).toHaveLength(3);
  });

  it('keeps the pill while open but not yet replayed', () => {
    render(consoleModel({ conn: 'open', state: null }));

    expect(banner()).not.toBeNull();
    expect(banner()!.textContent).toBe('SYNCING…');
  });

  it('drops the pill and reconciles to the replayed state on reopen', () => {
    // Same renderer across both frames: this is the real patch path, not a
    // fresh mount, so a stale highlight would survive if reconciliation broke.
    render(consoleModel({ conn: 'closed', state: null }));
    render(
      consoleModel({
        conn: 'open',
        state: stateWith({
          seq: 9,
          lane: 'bot',
          cars: [0, 0, 3],
          presets: ['Fuel save'],
        }),
      }),
    );

    expect(banner()).toBeNull();
    expect(
      root.querySelector('[data-testid="header-link"]')!.className,
    ).toContain('is-ok');
    const selected = root.querySelectorAll('.lane.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute('data-lane')).toBe('bot');
    expect(litSegments()).toEqual([
      [false, false, false],
      [false, false, false],
      [true, true, true],
    ]);
    expect(
      [...root.querySelectorAll('[data-act="preset-send"]')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['Fuel save']);
    expect(root.querySelectorAll('button[disabled]')).toHaveLength(0);
  });
});

describe('pill toggling never re-creates the controls', () => {
  it('keeps the same car segments and message input across hide and show', () => {
    render(consoleModel({ conn: 'closed', state: null }));
    const segmentsWhileDown = [...root.querySelectorAll('.seg')];
    const inputWhileDown = root.querySelector('[data-testid="msg-input"]');
    expect(segmentsWhileDown).toHaveLength(9);

    // Socket recovers and the room replays: the pill hides, but a
    // half-typed message in flight must survive it.
    render(consoleModel({ conn: 'open', state: stateWith({ seq: 4 }) }));
    expect(banner()).toBeNull();
    expect([...root.querySelectorAll('.seg')]).toEqual(segmentsWhileDown);
    expect(root.querySelector('[data-testid="msg-input"]')).toBe(
      inputWhileDown,
    );

    // And back again when it drops.
    render(consoleModel({ conn: 'closed', state: null }));
    expect(banner()).not.toBeNull();
    expect([...root.querySelectorAll('.seg')]).toEqual(segmentsWhileDown);
    expect(root.querySelector('[data-testid="msg-input"]')).toBe(
      inputWhileDown,
    );
  });

  it('keeps the input and the buttons below the chips when presets come and go', () => {
    render(consoleModel());
    const input = root.querySelector('[data-testid="msg-input"]');
    const save = root.querySelector('[data-testid="save"]');

    render(consoleModel({ state: stateWith({ seq: 2, presets: ['a', 'b'] }) }));
    render(consoleModel({ state: stateWith({ seq: 3, presets: [] }) }));

    expect(root.querySelector('[data-testid="msg-input"]')).toBe(input);
    expect(root.querySelector('[data-testid="save"]')).toBe(save);
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

describe('AC-4 ack icon', () => {
  const message = {
    id: '01J',
    text: 'box this lap',
    ts: 4_000,
    ackedAt: null as number | null,
  };

  it('shows the hourglass while the message is unacknowledged', () => {
    render(consoleModel({ state: stateWith({ msg: { ...message } }) }));

    expect(shown('[data-testid="header-ack"]')).toBe(true);
    expect(text('[data-testid="header-ack"]')).toBe('⌛');
    expect(
      root
        .querySelector('[data-testid="header-ack"]')!
        .getAttribute('aria-label'),
    ).toBe('message waiting');
  });

  it('shows the ack tick once ackedAt is non-null', () => {
    render(consoleModel({ state: stateWith({ msg: { ...message } }) }));
    render(
      consoleModel({
        state: stateWith({ seq: 2, msg: { ...message, ackedAt: 4_200 } }),
      }),
    );

    expect(text('[data-testid="header-ack"]')).toBe('✓');
    expect(
      root.querySelector('[data-testid="header-ack"]')!.className,
    ).toContain('is-acked');
  });

  it('hides the ack icon when the room holds no message', () => {
    render(consoleModel({ state: stateWith({ msg: null }) }));

    expect(shown('[data-testid="header-ack"]')).toBe(false);
  });
});

describe('messages (design round 4)', () => {
  it('offers the five built-in messages as one-tap buttons', () => {
    render(consoleModel());

    expect(
      [...root.querySelectorAll('[data-act="say"]')].map((el) => [
        el.textContent,
        el.getAttribute('data-arg'),
      ]),
    ).toEqual([
      ['PULL OFF', 'PULL OFF'],
      ['LEADERS BEHIND', 'LEADERS BEHIND'],
      ['BACK UP ENTRY', 'BACK UP ENTRY'],
      ['DRIVE IN FURTHER', 'DRIVE IN FURTHER'],
      ['SPIN', 'SPIN'],
    ]);
  });

  it('renders the room presets as chips with a remove button each, from room state only', () => {
    render(consoleModel({ state: stateWith({ presets: [] }) }));
    expect(shown('[data-testid="preset-chips"]')).toBe(false);

    render(
      consoleModel({
        state: stateWith({ presets: ['Fuel save', 'Box box'] }),
      }),
    );
    expect(shown('[data-testid="preset-chips"]')).toBe(true);
    expect(
      [...root.querySelectorAll('.pchip')].map((chip) =>
        [...chip.children].map((el) => [
          el.getAttribute('data-act'),
          el.getAttribute('data-arg'),
        ]),
      ),
    ).toEqual([
      [
        ['preset-send', 'Fuel save'],
        ['preset-remove', 'Fuel save'],
      ],
      [
        ['preset-send', 'Box box'],
        ['preset-remove', 'Box box'],
      ],
    ]);

    // A room from a relay that predates presets simply has none.
    const legacy = stateWith();
    delete legacy.presets;
    render(consoleModel({ state: legacy }));
    expect(root.querySelectorAll('.pchip')).toHaveLength(0);
  });

  it('caps the message input at MSG_MAX_CHARS and offers Send and Save', () => {
    render(consoleModel());

    const input = root.querySelector(
      '[data-testid="msg-input"]',
    ) as HTMLInputElement;
    expect(input.getAttribute('maxlength')).toBe(String(MSG_MAX_CHARS));
    expect(text('[data-testid="send"]')).toBe('Send');
    expect(text('[data-testid="save"]')).toBe('Save');
    expect(root.querySelector('[data-testid="lane-clear"]')).not.toBeNull();
    // Recent-message chips from localStorage are gone (presets replace them).
    expect(root.querySelectorAll('[data-act="recent"]')).toHaveLength(0);
  });

  it('marks Save unavailable once the room holds PRESETS_MAX messages', () => {
    const presets = Array.from({ length: PRESETS_MAX }, (_, i) => `p${i}`);
    render(consoleModel({ state: stateWith({ presets }) }));

    const save = root.querySelector('[data-testid="save"]')!;
    expect(save.textContent).toBe('Full');
    expect(save.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('join screen (design round 4)', () => {
  it('shows a generated room code large and asks for a PIN on a new visit', () => {
    render(
      createModel({
        screen: 'join',
        joinMode: 'new',
        form: { room: 'K3Q9ZA', pin: '', name: '' },
        relayHost: 'wss://relay.example.com',
      }),
    );

    expect(shown('[data-testid="join-new"]')).toBe(true);
    expect(shown('[data-testid="join-form"]')).toBe(false);
    expect(text('[data-testid="join-code"]')).toBe('K3Q9ZA');
    expect(
      root
        .querySelector('[data-testid="start-pin"]')!
        .getAttribute('inputmode'),
    ).toBe('numeric');
    expect(
      root
        .querySelector('[data-testid="start"]')!
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(text('[data-testid="join-existing"]')).toBe('Join an existing room');
    expect(text('[data-testid="join-host"]')).toBe(
      'relay wss://relay.example.com',
    );
  });

  it('enables Start once four digits are in', () => {
    render(
      createModel({
        screen: 'join',
        joinMode: 'new',
        form: { room: 'K3Q9ZA', pin: '4821', name: '' },
      }),
    );

    expect(
      root
        .querySelector('[data-testid="start"]')!
        .getAttribute('aria-disabled'),
    ).toBe('false');
  });

  it('keeps the classic form behind "Join an existing room"', () => {
    render(
      createModel({
        screen: 'join',
        joinMode: 'existing',
        form: { room: 'CAR42', pin: '1234', name: 'Sam' },
      }),
    );

    expect(shown('[data-testid="join-new"]')).toBe(false);
    expect(shown('[data-testid="join-form"]')).toBe(true);
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
        notice: 'Wrong PIN — check the room code and PIN.',
      }),
    );

    const notice = root.querySelector('[data-testid="join-notice"]')!;
    expect(notice.hasAttribute('hidden')).toBe(false);
    expect(notice.textContent).toContain('Wrong PIN');
  });

  it('keeps the fields stable when a notice appears or the mode flips', () => {
    const form = { room: 'CAR42', pin: '', name: '' };
    render(createModel({ screen: 'join', form }));
    const roomField = root.querySelector('[data-testid="join-room"]');
    const startPin = root.querySelector('[data-testid="start-pin"]');

    render(createModel({ screen: 'join', form, notice: 'Wrong PIN.' }));
    render(createModel({ screen: 'join', form, joinMode: 'new' }));

    expect(root.querySelector('[data-testid="join-room"]')).toBe(roomField);
    expect(root.querySelector('[data-testid="start-pin"]')).toBe(startPin);
  });
});
