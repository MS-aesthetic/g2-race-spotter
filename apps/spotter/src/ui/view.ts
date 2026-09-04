import { MSG_MAX_CHARS, type Lane } from '@g2-race-spotter/protocol';

import { isLatencyStale, isLive, selectedLane, type Model } from '../model.ts';
import { isValidRoom } from '../storage.ts';
import { h, type VNode } from './vdom.ts';

interface LaneButton {
  lane: Lane;
  glyph: string;
  label: string;
}

/** Glasses order, top to bottom — the spotter's thumb maps to what the driver
 * sees, not to a list sorted some other way. */
const LANES: readonly LaneButton[] = [
  { lane: 'top', glyph: '▲', label: 'TOP' },
  { lane: 'mid', glyph: '●', label: 'MIDDLE' },
  { lane: 'bot', glyph: '▼', label: 'BOTTOM' },
];

const GAP_CHIPS: readonly number[] = [0, 25, 50, 75, 100];

/** Above this the track turns red, mirroring the glasses' inverted bar. */
export const GAP_HOT = 75;

function latencyText(model: Model): string {
  return model.latencyMs === null ? '— ms' : `${model.latencyMs} ms`;
}

/** `✓ acked` once the driver has acknowledged, `… waiting` while a message is
 * outstanding, nothing when there is no message in the room. */
function ackText(model: Model): string | null {
  const message = model.state?.msg;
  if (message === null || message === undefined) {
    return null;
  }

  return message.ackedAt === null ? '… waiting' : '✓ acked';
}

function statusHeader(model: Model): VNode {
  const live = isLive(model);
  const driverOnline = model.state?.driverOnline === true;
  const ack = ackText(model);
  const classes = ['header'];
  if (!live) {
    classes.push('header--down');
  } else if (!driverOnline) {
    classes.push('header--offline');
  }

  const parts: VNode[] = [
    h('span', { class: 'header__room', 'data-testid': 'header-room' }, [
      `ROOM ${model.form.room}`,
    ]),
    h('span', { class: 'header__sep' }, ['·']),
    h('span', { class: 'header__driver', 'data-testid': 'header-driver' }, [
      driverOnline ? 'DRIVER ONLINE' : 'DRIVER OFFLINE',
    ]),
    h('span', { class: 'header__sep' }, ['·']),
    h(
      'span',
      {
        class: isLatencyStale(model)
          ? 'header__latency is-stale'
          : 'header__latency',
        'data-testid': 'header-latency',
      },
      [latencyText(model)],
    ),
  ];

  if (ack !== null) {
    parts.push(
      h('span', { class: 'header__sep' }, ['·']),
      h('span', { class: 'header__ack', 'data-testid': 'header-ack' }, [ack]),
    );
  }

  return h(
    'header',
    { class: classes.join(' '), role: 'status', 'aria-live': 'polite' },
    parts,
  );
}

/**
 * Always rendered, `hidden` when the room is live. A conditional child would
 * change `.console`'s child count, and the positional diff would then replace
 * `<main>` wholesale — killing an in-flight slider drag (its `change` would
 * fire on a detached node, so `release()` would never send) and dropping the
 * message field's focus and keyboard exactly when the socket wobbles.
 */
function reconnectBanner(model: Model): VNode {
  const live = isLive(model);
  // Open-but-not-replayed is a different story from a dead socket: the spotter
  // should not be told to worry about the network while the room is replaying.
  const text = model.conn === 'open' ? 'SYNCING…' : 'RECONNECTING';

  return h(
    'div',
    {
      class: 'banner',
      role: 'alert',
      'data-testid': 'reconnect-banner',
      'data-conn': model.conn,
      hidden: live,
    },
    [live ? '' : text],
  );
}

function laneStack(model: Model): VNode {
  const selected = selectedLane(model);

  return h('section', { class: 'lanes' }, [
    ...LANES.map((button) =>
      h(
        'button',
        {
          type: 'button',
          class: button.lane === selected ? 'lane is-selected' : 'lane',
          'data-act': 'lane',
          'data-arg': button.lane,
          'data-lane': button.lane,
          'aria-pressed': button.lane === selected ? 'true' : 'false',
        },
        [
          h('span', { class: 'lane__glyph', 'aria-hidden': 'true' }, [
            button.glyph,
          ]),
          h('span', { class: 'lane__label' }, [button.label]),
        ],
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'lane-clear',
        'data-act': 'lane-clear',
        'data-testid': 'lane-clear',
      },
      ['clear lane'],
    ),
  ]);
}

function gapSection(model: Model): VNode {
  const gap = model.gap;

  return h('section', { class: gap > GAP_HOT ? 'gap is-hot' : 'gap' }, [
    h('div', { class: 'gap__value', 'data-testid': 'gap-value' }, [
      String(gap),
    ]),
    h('input', {
      type: 'range',
      min: 0,
      max: 100,
      step: 1,
      value: gap,
      class: 'gap__range',
      'data-act': 'gap',
      'data-testid': 'gap-range',
      'aria-label': 'Car behind',
      style: `--gap:${gap}%`,
    }),
    h('div', { class: 'gap__scale' }, [
      h('span', {}, ['CLEAR']),
      h('span', {}, ['ON BUMPER']),
    ]),
    h(
      'div',
      { class: 'gap__chips' },
      GAP_CHIPS.map((value) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip',
            'data-act': 'gap-chip',
            'data-arg': value,
          },
          [String(value)],
        ),
      ),
    ),
  ]);
}

function messageSection(model: Model): VNode {
  return h('section', { class: 'msg' }, [
    h('input', {
      type: 'text',
      class: 'msg__input',
      value: model.draft,
      maxlength: MSG_MAX_CHARS,
      placeholder: 'Message the driver',
      enterkeyhint: 'send',
      autocomplete: 'off',
      autocapitalize: 'sentences',
      'data-act': 'draft',
      'data-testid': 'msg-input',
      'aria-label': 'Message',
    }),
    h('div', { class: 'msg__actions' }, [
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary',
          'data-act': 'send',
          'data-testid': 'send',
        },
        ['Send'],
      ),
      h('button', { type: 'button', class: 'btn', 'data-act': 'clear' }, [
        'Clear',
      ]),
    ]),
    h(
      'div',
      { class: 'msg__chips', 'data-testid': 'recent-chips' },
      model.recent.map((text) =>
        h(
          'button',
          {
            type: 'button',
            class: 'chip chip--msg',
            'data-act': 'recent',
            'data-arg': text,
          },
          [text],
        ),
      ),
    ),
  ]);
}

function consoleView(model: Model): VNode {
  // Fixed child count, fixed order: every slot is always present and toggled
  // with `hidden`, so the positional diff only ever patches in place.
  return h('div', { class: 'console' }, [
    statusHeader(model),
    reconnectBanner(model),
    h('main', { class: 'console__body' }, [
      laneStack(model),
      h('div', { class: 'console__right' }, [
        gapSection(model),
        messageSection(model),
      ]),
    ]),
    h(
      'button',
      {
        type: 'button',
        class: 'toast',
        'data-act': 'reload',
        'data-testid': 'update-toast',
        hidden: !model.updateReady,
      },
      ['update available — reload'],
    ),
  ]);
}

function field(
  label: string,
  props: Record<string, string | number | boolean>,
): VNode {
  return h('label', { class: 'field' }, [
    h('span', { class: 'field__label' }, [label]),
    h('input', { class: 'field__input', ...props }),
  ]);
}

function joinView(model: Model): VNode {
  const children: VNode[] = [
    h('h1', { class: 'join__title' }, ['Race Spotter']),
    field('Room code', {
      type: 'text',
      value: model.form.room,
      maxlength: 6,
      autocapitalize: 'characters',
      autocorrect: 'off',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'CAR42',
      'data-act': 'room',
      'data-testid': 'join-room',
    }),
    field('PIN (optional)', {
      type: 'text',
      value: model.form.pin,
      inputmode: 'numeric',
      maxlength: 4,
      autocomplete: 'off',
      placeholder: '0000',
      'data-act': 'pin',
      'data-testid': 'join-pin',
    }),
    field('Your name', {
      type: 'text',
      value: model.form.name,
      maxlength: 24,
      autocomplete: 'off',
      placeholder: 'Spotter',
      'data-act': 'name',
      'data-testid': 'join-name',
    }),
    // Constant slots here too: a notice appearing between the fields and the
    // button would otherwise re-create the button on every failed join.
    h(
      'p',
      {
        class: 'join__notice',
        role: 'alert',
        'data-testid': 'join-notice',
        hidden: model.notice === null,
      },
      [model.notice ?? ''],
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--join',
        'data-act': 'join',
        'data-testid': 'join',
        'aria-disabled': isValidRoom(model.form.room) ? 'false' : 'true',
      },
      ['Join as spotter'],
    ),
    h('p', { class: 'join__host', 'data-testid': 'join-host' }, [
      `relay ${model.relayHost}`,
    ]),
    h('p', { class: 'join__hint', hidden: !model.showInstallHint }, [
      'Add to Home Screen for full-screen use — iOS: Share → Add to Home Screen.',
    ]),
  ];

  return h('div', { class: 'join' }, children);
}

/** The whole UI as a pure function of the model — no handlers, no globals. */
export function view(model: Model): VNode {
  return model.screen === 'join' ? joinView(model) : consoleView(model);
}
