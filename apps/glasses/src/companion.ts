/**
 * The phone-side companion page: room / PIN / name / render override, the
 * connection status, and a log panel carrying the `{call, ms, result}` lines so
 * a bridge problem is visible without a USB cable.
 *
 * DOM only — every decision it shows comes from `settings.ts` / `link.ts`.
 */

import type { BridgeCallLog } from './bridge.ts';
import { glyph } from './render/glyphs.ts';
import {
  isValidPin,
  isValidRoom,
  normalisePin,
  normaliseRoom,
  type Settings,
} from './settings.ts';
import type { RenderMode } from './render/mode.ts';

const LOG_LINES = 40;

const TEMPLATE = `
<form id="g2rs-form" autocomplete="off">
  <label>Room <input id="g2rs-room" inputmode="latin" maxlength="6" placeholder="QA01" /></label>
  <label>PIN <input id="g2rs-pin" inputmode="numeric" maxlength="4" placeholder="optional" /></label>
  <label>Name <input id="g2rs-name" maxlength="24" placeholder="driver" /></label>
  <label>HUD <select id="g2rs-render">
    <option value="">default (image)</option>
    <option value="image">image</option>
    <option value="text">text</option>
  </select></label>
  <button type="submit">Save &amp; connect</button>
</form>
<p id="g2rs-status"></p>
<p id="g2rs-warning" hidden></p>
<pre id="g2rs-log"></pre>
`;

export interface CompanionOptions {
  readonly root: HTMLElement;
  readonly settings: Settings;
  readonly mode: RenderMode;
  readonly warning: string | null;
  readonly onSave: (settings: Settings) => void;
}

export interface Companion {
  setStatus(text: string): void;
  append(entry: BridgeCallLog): void;
}

function element<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const found = root.querySelector<T>(`#${id}`);
  if (found === null) {
    throw new Error(`companion page is missing #${id}`);
  }

  return found;
}

export function mountCompanion(options: CompanionOptions): Companion {
  const { root } = options;
  root.innerHTML = TEMPLATE;

  const form = element<HTMLFormElement>(root, 'g2rs-form');
  const room = element<HTMLInputElement>(root, 'g2rs-room');
  const pin = element<HTMLInputElement>(root, 'g2rs-pin');
  const name = element<HTMLInputElement>(root, 'g2rs-name');
  const render = element<HTMLSelectElement>(root, 'g2rs-render');
  const status = element<HTMLParagraphElement>(root, 'g2rs-status');
  const warning = element<HTMLParagraphElement>(root, 'g2rs-warning');
  const log = element<HTMLPreElement>(root, 'g2rs-log');
  const lines: string[] = [];

  // Non-ASCII belongs to glyphs.ts alone (030 R6), companion page included.
  status.textContent = `starting${glyph('ellipsis')}`;
  room.value = options.settings.room;
  pin.value = options.settings.pin;
  name.value = options.settings.name;
  render.value = options.settings.render ?? '';

  if (options.warning !== null) {
    warning.textContent = options.warning;
    warning.hidden = false;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const next: Settings = {
      room: normaliseRoom(room.value),
      pin: normalisePin(pin.value),
      name: name.value.trim(),
      render:
        render.value === 'image' || render.value === 'text'
          ? render.value
          : null,
    };

    room.value = next.room;
    pin.value = next.pin;

    if (!isValidRoom(next.room) || !isValidPin(next.pin)) {
      status.textContent =
        'Room is 4-6 letters/digits; PIN is 4 digits or empty.';
      return;
    }

    options.onSave(next);
  });

  return {
    setStatus(text: string): void {
      status.textContent = text;
    },
    append(entry: BridgeCallLog): void {
      lines.push(
        `${entry.call} ${Math.round(entry.ms)}ms ${JSON.stringify(entry.result)}`,
      );
      if (lines.length > LOG_LINES) {
        lines.shift();
      }
      log.textContent = lines.join('\n');
    },
  };
}
