# Alert sound sources & licensing

## Original synthesized sounds (owned outright)

`chime.wav`, `bell.wav`, `pulse.wav`, `soft.wav`, `urgent.wav` were synthesized in-house for
Gluco Guardian (2026-07). No third-party rights involved.

## Mixkit royalty-free sound effects

The files below are from Mixkit (https://mixkit.co), used under the **Mixkit Sound Effects Free
License** (https://mixkit.co/license/#sfxFree): free for commercial and non-commercial use in
projects/apps, no attribution required, no payment. They may not be redistributed as standalone
files — bundling them inside this app as notification sounds is a licensed use.

All files were converted for iOS notification requirements: WAVE container, Linear PCM 16-bit,
mono, 44.1 kHz, fade-out and peak-normalized to −1 dBFS. Alarms are cut on pulse boundaries
found by envelope/zero-crossing analysis: repeating alarms keep exactly 3 pulses, `emergency.wav`
keeps a single 1.2 s whoop cycle, and continuous alarms (`siren`, `alertalarm`) are capped at
2.5 s (siren's near-silent spin-up removed first). Gentle tones are capped at 4 s.

| File | Mixkit title | Mixkit id |
| --- | --- | --- |
| emergency.wav | Emergency alert alarm | 1007 |
| critical.wav | Critical alarm | 1004 |
| classicalarm.wav | Classic alarm | 995 |
| warningbuzzer.wav | Warning alarm buzzer | 991 |
| redalert.wav | Vintage warning alarm | 990 |
| siren.wav | City alert siren loop | 1008 |
| security.wav | Security facility breach alarm | 994 |
| alertalarm.wav | Alert alarm | 1005 |
| alarmtone.wav | Alarm tone | 996 |
| shortalarm.wav | Classic short alarm | 993 |
| alarmclock.wav | Alarm clock beep | 988 |
| urgentloop.wav | Urgent simple tone loop | 2976 |
| battleship.wav | Battleship alarm | 1001 |
| retroalarm.wav | Retro game emergency alarm | 1000 |
| ding.wav | Bell notification | 933 |
| happybells.wav | Happy bells notification | 937 |
| positive.wav | Positive notification | 951 |
| bright.wav | Correct answer tone | 2870 |
| pop.wav | Message pop alert | 2354 |
| announce.wav | Clear announce tones | 2861 |
| marimba.wav | Magic marimba | 2820 |
| guitar.wav | Guitar notification alert | 2320 |
| flute.wav | Uplifting flute notification | 2317 |

Source URL pattern: `https://assets.mixkit.co/active_storage/sfx/<id>/<id>.wav`
