import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  type Lane,
} from '@g2-race-spotter/protocol';

import { CAR_ROWS, CAR_SEGMENTS } from '../intents.ts';
import {
  isLatencyStale,
  isLive,
  selectedCars,
  selectedLane,
  type Model,
} from '../model.ts';
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
  { lane: 'mid', glyph: '▬', label: 'MIDDLE' },
  { lane: 'bot', glyph: '▼', label: 'BOTTOM' },
];

/** A row at this level turns red, mirroring the glasses' bright-outline bar. */
export const CAR_HOT = CAR_LEVEL_MAX;

/** Only the last three fit the one-row strip; the console never scrolls. */
export const RECENT_CHIPS_SHOWN = 3;

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
 * `<main>` wholesale — dropping the message field's focus and keyboard exactly
 * when the socket wobbles.
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

/**
 * Three rows, LEFT / MIDDLE / RIGHT, each a 3-segment bar (Maxx, 2026-09-25
 * design round 3). Segment n calls level n; the lit top segment clears the
 * row. Segments `1..level` are lit, filled left to right like the glasses.
 */
function carsSection(model: Model): VNode {
  const cars = selectedCars(model);

  return h(
    'section',
    {
      class: 'cars',
      role: 'group',
      'aria-label': 'Cars behind',
      'data-testid': 'car-rows',
    },
    CAR_ROWS.map((row) => {
      const level = cars[row.index];
      const rowClasses = ['carrow'];
      if (level >= CAR_HOT) {
        rowClasses.push('carrow--hot');
      }

      return h(
        'div',
        {
          class: rowClasses.join(' '),
          role: 'group',
          'aria-label': `${row.label} car behind`,
          'data-row': row.index,
          'data-level': level,
        },
        [
          h('span', { class: 'carrow__label' }, [row.label]),
          ...CAR_SEGMENTS.map((segment) => {
            const lit = segment <= level;
            const classes = ['seg'];
            if (lit) {
              classes.push('is-lit');
            }
            if (segment === level) {
              classes.push('is-top');
            }

            return h(
              'button',
              {
                type: 'button',
                class: classes.join(' '),
                'data-act': 'car',
                'data-arg': `${row.index}:${segment}`,
                'data-seg': segment,
                'aria-pressed': lit ? 'true' : 'false',
                'aria-label': `${row.label} ${segment}`,
              },
              [String(segment)],
            );
          }),
        ],
      );
    }),
  );
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
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary btn--send',
        'data-act': 'send',
        'data-testid': 'send',
      },
      ['Send'],
    ),
    h(
      'button',
      { type: 'button', class: 'btn btn--clear', 'data-act': 'clear' },
      ['Clear'],
    ),
    h(
      'div',
      { class: 'msg__chips', 'data-testid': 'recent-chips' },
      model.recent.slice(0, RECENT_CHIPS_SHOWN).map((text) =>
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
        carsSection(model),
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
