import {
  CAR_LEVEL_MAX,
  MSG_MAX_CHARS,
  PRESETS_MAX,
  type Lane,
} from '@g2-race-spotter/protocol';

import { BUILTIN_MESSAGES, CAR_ROWS, CAR_SEGMENTS } from '../intents.ts';
import {
  isLatencyStale,
  isLive,
  roomPresets,
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

/**
 * Left to right as Maxx holds the phone (2026-09-25 design round 4): "Bottom
 * is the left most buttons, Middle is middle, and top is right."
 */
export const LANES: readonly LaneButton[] = [
  { lane: 'bot', glyph: '▼', label: 'BOTTOM' },
  { lane: 'mid', glyph: '▬', label: 'MIDDLE' },
  { lane: 'top', glyph: '▲', label: 'TOP' },
];

/** A slider at this level turns red, mirroring the glasses' alert outline. */
export const CAR_HOT = CAR_LEVEL_MAX;

/** Segments top to bottom in the DOM, so the meter fills bottom-up. */
const SEGMENTS_TOP_DOWN = [...CAR_SEGMENTS].reverse();

function latencyText(model: Model): string {
  return model.latencyMs === null ? '— ms' : `${model.latencyMs} ms`;
}

/**
 * One compact row (design round 4): room chip, link dot + RECONNECTING pill,
 * driver dot, ack icon, latency. Every slot is always rendered and toggled
 * with `hidden`, so the positional diff never re-creates a control.
 */
function statusHeader(model: Model): VNode {
  const live = isLive(model);
  const driverOnline = model.state?.driverOnline === true;
  const message = model.state?.msg ?? null;
  const acked = message !== null && message.ackedAt !== null;
  // Open-but-not-replayed is a different story from a dead socket: the spotter
  // should not be told to worry about the network while the room is replaying.
  const pill = model.conn === 'open' ? 'SYNCING…' : 'RECONNECTING';

  return h('header', { class: 'hdr', role: 'status', 'aria-live': 'polite' }, [
    h(
      'button',
      {
        type: 'button',
        class: 'hdr__code',
        'data-act': 'code',
        'data-testid': 'header-room',
        'aria-label': `Room ${model.form.room}: show it large`,
        'aria-expanded': model.showCode ? 'true' : 'false',
      },
      [h('span', { class: 'hdr__chip' }, [model.form.room])],
    ),
    h(
      'span',
      {
        class: live ? 'dot is-ok' : 'dot is-down',
        'data-testid': 'header-link',
        role: 'img',
        'aria-label': live ? 'link ok' : 'link down',
        title: live ? 'Link OK' : 'Link down',
      },
      [],
    ),
    h(
      'span',
      {
        class: 'pill',
        role: 'alert',
        'data-testid': 'reconnect-pill',
        'data-conn': model.conn,
        hidden: live,
      },
      [live ? '' : pill],
    ),
    h(
      'span',
      {
        class: driverOnline ? 'dot is-on' : 'dot is-off',
        'data-testid': 'header-driver',
        'data-online': driverOnline ? 'true' : 'false',
        role: 'img',
        'aria-label': driverOnline ? 'driver online' : 'driver offline',
        title: driverOnline ? 'Driver online' : 'Driver offline',
      },
      [],
    ),
    h(
      'span',
      {
        class: acked ? 'hdr__ack is-acked' : 'hdr__ack',
        'data-testid': 'header-ack',
        role: 'img',
        'aria-label': acked ? 'message acked' : 'message waiting',
        title: acked ? 'Driver acked' : 'Waiting for the driver',
        hidden: message === null,
      },
      [acked ? '✓' : '⌛'],
    ),
    h(
      'span',
      {
        class: isLatencyStale(model) ? 'hdr__latency is-stale' : 'hdr__latency',
        'data-testid': 'header-latency',
      },
      [latencyText(model)],
    ),
  ]);
}

function laneRow(model: Model): VNode {
  const selected = selectedLane(model);

  return h('section', { class: 'lanes', 'aria-label': 'Lane' }, [
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
        'aria-label': 'clear lane',
      },
      [
        h('span', { class: 'lane__glyph', 'aria-hidden': 'true' }, ['✕']),
        h('span', { class: 'lane-clear__label' }, ['CLEAR']),
      ],
    ),
  ]);
}

/**
 * Three vertical 3-segment sliders, LEFT / MIDDLE / RIGHT (design round 4):
 * segment n calls level n, the lit top segment clears it, a drag across the
 * segments sets the level on release. Segments `1..level` are lit from the
 * bottom up, like a level meter.
 */
function sliders(model: Model): VNode {
  const cars = selectedCars(model);

  return h(
    'section',
    {
      class: 'sliders',
      role: 'group',
      'aria-label': 'Cars behind',
      'data-testid': 'car-rows',
    },
    CAR_ROWS.map((row) => {
      const level = cars[row.index];
      const classes = ['slider'];
      if (level >= CAR_HOT) {
        classes.push('slider--hot');
      }

      return h(
        'div',
        {
          class: classes.join(' '),
          role: 'group',
          'aria-label': `${row.label} car behind`,
          'data-row': row.index,
          'data-level': level,
        },
        [
          ...SEGMENTS_TOP_DOWN.map((segment) => {
            const lit = segment <= level;
            const segClasses = ['seg'];
            if (lit) {
              segClasses.push('is-lit');
            }
            if (segment === level) {
              segClasses.push('is-top');
            }

            return h(
              'button',
              {
                type: 'button',
                class: segClasses.join(' '),
                'data-act': 'car',
                'data-arg': `${row.index}:${segment}`,
                'data-seg': segment,
                'aria-pressed': lit ? 'true' : 'false',
                'aria-label': `${row.label} ${segment}`,
              },
              [String(segment)],
            );
          }),
          h(
            'span',
            {
              class: 'slider__label',
              'data-act': 'car-zero',
              'data-arg': `${row.index}:0`,
            },
            [row.label],
          ),
        ],
      );
    }),
  );
}

function builtinMessages(): VNode {
  return h(
    'div',
    { class: 'says', 'data-testid': 'builtin-messages' },
    BUILTIN_MESSAGES.map((text) =>
      h(
        'button',
        {
          type: 'button',
          class: 'say',
          'data-act': 'say',
          'data-arg': text,
        },
        [text],
      ),
    ),
  );
}

/** The room's saved messages as chips: tap sends, × forgets. The slot is
 * always rendered and hidden while the room has none. */
function presetChips(model: Model): VNode {
  const presets = roomPresets(model);

  return h(
    'div',
    {
      class: 'presets',
      'data-testid': 'preset-chips',
      hidden: presets.length === 0,
    },
    presets.map((text) =>
      h('div', { class: 'pchip' }, [
        h(
          'button',
          {
            type: 'button',
            class: 'pchip__text',
            'data-act': 'preset-send',
            'data-arg': text,
          },
          [text],
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'pchip__x',
            'data-act': 'preset-remove',
            'data-arg': text,
            'aria-label': `Forget "${text}"`,
          },
          ['×'],
        ),
      ]),
    ),
  );
}

function messageRow(model: Model): VNode {
  const full = roomPresets(model).length >= PRESETS_MAX;

  return h('div', { class: 'msg' }, [
    h('input', {
      type: 'text',
      class: 'msg__input',
      value: model.draft,
      maxlength: MSG_MAX_CHARS,
      placeholder: 'Type a short message',
      enterkeyhint: 'send',
      autocomplete: 'off',
      autocapitalize: 'characters',
      'data-act': 'draft',
      'data-testid': 'msg-input',
      'aria-label': 'Message',
    }),
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
    h(
      'button',
      {
        type: 'button',
        class: 'btn',
        'data-act': 'save',
        'data-testid': 'save',
        'aria-disabled': full ? 'true' : 'false',
        title: full ? `The room keeps ${PRESETS_MAX} messages` : 'Save',
      },
      [full ? 'Full' : 'Save'],
    ),
  ]);
}

/** The room code, large, for the driver to copy into the glasses app. */
function codeOverlay(model: Model): VNode {
  return h(
    'div',
    {
      class: 'codeview',
      role: 'dialog',
      'aria-label': 'Room code',
      'data-act': 'code',
      'data-testid': 'code-overlay',
      hidden: !model.showCode,
    },
    [
      h('p', { class: 'codeview__label' }, ['ROOM']),
      h('p', { class: 'codeview__code' }, [model.form.room]),
      h('p', { class: 'codeview__pin' }, [
        model.form.pin === '' ? 'no PIN' : `PIN ${model.form.pin}`,
      ]),
      h('p', { class: 'codeview__hint' }, [
        'Driver: enter this room and PIN in the glasses app. Tap to close.',
      ]),
    ],
  );
}

function consoleView(model: Model): VNode {
  // Fixed child count, fixed order: every slot is always present and toggled
  // with `hidden`, so the positional diff only ever patches in place.
  return h('div', { class: 'console' }, [
    statusHeader(model),
    h('main', { class: 'console__body' }, [
      h('section', { class: 'half half--top', 'data-testid': 'top-half' }, [
        laneRow(model),
        sliders(model),
      ]),
      h(
        'section',
        { class: 'half half--bottom', 'data-testid': 'bottom-half' },
        [builtinMessages(), presetChips(model), messageRow(model)],
      ),
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
    codeOverlay(model),
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

function nameField(model: Model, testId: string): VNode {
  return field('Your name (optional)', {
    type: 'text',
    value: model.form.name,
    maxlength: 24,
    autocomplete: 'off',
    placeholder: 'Spotter',
    'data-act': 'name',
    'data-testid': testId,
  });
}

/** First visit: the generated room code, large, and a required PIN. */
function newRoomSection(model: Model): VNode {
  return h(
    'section',
    {
      class: 'join__section',
      'data-testid': 'join-new',
      hidden: model.joinMode !== 'new',
    },
    [
      h('p', { class: 'field__label' }, ['Your room']),
      h('p', { class: 'join__code', 'data-testid': 'join-code' }, [
        model.form.room,
      ]),
      field('Set a PIN (4 digits)', {
        type: 'text',
        value: model.form.pin,
        inputmode: 'numeric',
        maxlength: 4,
        autocomplete: 'off',
        placeholder: '0000',
        'data-act': 'pin',
        'data-testid': 'start-pin',
      }),
      nameField(model, 'start-name'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary btn--join',
          'data-act': 'start',
          'data-testid': 'start',
          'aria-disabled': /^\d{4}$/.test(model.form.pin) ? 'false' : 'true',
        },
        ['Start'],
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          'data-act': 'join-existing',
          'data-testid': 'join-existing',
        },
        ['Join an existing room'],
      ),
    ],
  );
}

/** A second spotter (or the driver's phone) joins a room it was told. */
function existingRoomSection(model: Model): VNode {
  return h(
    'section',
    {
      class: 'join__section',
      'data-testid': 'join-form',
      hidden: model.joinMode !== 'existing',
    },
    [
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
      field('PIN', {
        type: 'text',
        value: model.form.pin,
        inputmode: 'numeric',
        maxlength: 4,
        autocomplete: 'off',
        placeholder: '0000',
        'data-act': 'pin',
        'data-testid': 'join-pin',
      }),
      nameField(model, 'join-name'),
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
      h(
        'button',
        {
          type: 'button',
          class: 'link',
          'data-act': 'join-new',
          'data-testid': 'join-new-room',
        },
        ['Start a new room'],
      ),
    ],
  );
}

function joinView(model: Model): VNode {
  return h('div', { class: 'join' }, [
    h('h1', { class: 'join__title' }, ['Race Spotter']),
    newRoomSection(model),
    existingRoomSection(model),
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
    h('p', { class: 'join__host', 'data-testid': 'join-host' }, [
      `relay ${model.relayHost}`,
    ]),
    h('p', { class: 'join__hint', hidden: !model.showInstallHint }, [
      'Add to Home Screen for full-screen use — iOS: Share → Add to Home Screen.',
    ]),
  ]);
}

/** The whole UI as a pure function of the model — no handlers, no globals. */
export function view(model: Model): VNode {
  return model.screen === 'join' ? joinView(model) : consoleView(model);
}
