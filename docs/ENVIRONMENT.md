# G2 Race Spotter environment

This records the toolchain used for this repository. Change a pinned version only
as its own task, then update this file and its verifier together.

## Pinned toolchain

| Field | Value | Source |
| --- | --- | --- |
| SDK | `0.0.12` | `apps/glasses/package.json` |
| CLI | `0.1.12` | `apps/glasses/package.json` |
| Simulator | `0.9.5` | `apps/glasses/package.json` |
| Node | `22.23.2` | observed while bootstrapping; `.nvmrc` pins major `22` |
| Wrangler | `4.68.0` | `services/relay/package.json` |

## Simulator observation

| Field | Value | Status |
| --- | --- | --- |
| Simulator `bridge.getDeviceInfo()` | `TBD` | Recorded by T002c's simulator smoke run. |

## Hardware observations (human-recorded)

| Field | Value | Status |
| --- | --- | --- |
| Even app version | `TBD` | Requires the AC-4 hardware sideload. |
| Glasses firmware | `TBD` | Requires the AC-4 hardware sideload. |
| Hardware `getDeviceInfo()` | `TBD` | Requires the AC-4 hardware sideload. |
| Baked font fits one line in 28 px | `TBD` | Requires 030 AC-9 hardware glyph verification. |
| Gray4 nibble order on glasses | `TBD` | Requires 050 AC-6 hardware test pattern. |
