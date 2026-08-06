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

## Batch 2 — added 2026-08-06

Supplied by Brett in `new sound effect/` at the repo root. 17 of the 22 arrived as **mp3**, which iOS
does NOT accept for notification sounds, so every file was re-encoded to 16-bit PCM 44.1 kHz WAV
(matching batch 1) with `ffmpeg -c:a pcm_s16le -ar 44100`. All are under 3 s, well inside iOS's 30 s
limit. Original filenames kept here for provenance — several name their source (Freesound, Pixabay
contributors, Tunetank, SoundJay, ElevenLabs).

| Bundled file | Picker label | Bucket | Original filename |
|---|---|---|---|
| uprising.wav | Uprising | alarms | `420506__jfrecords__uprising1.wav` |
| weatherwarn.wav | Weather Warning | alarms | `49053354-weather-warning-313219.mp3` |
| lowfuel.wav | Low Fuel | alarms | `ALRMElec-Helicopter_low_fuel_-Elevenlabs.wav` |
| alertmain.wav | Alert Main | alarms | `soundjay_alert_main-01.mp3` |
| lowbattery.wav | Low Battery | alarms | `kave_msri-low-battery-alert-sfx-345413.mp3` |
| actionneeded.wav | Action Needed | alarms | `tunetank.com_notification-action-needed-alert-(double).wav` |
| warningalert.wav | Warning Alert | alarms | `universfield-warning-alert-132471.mp3` |
| warningnotify.wav | Warning Notify | alarms | `universfield-warning-notification-199277.mp3` |
| alerte.wav | Alerte | alarms | `alexis_gaming_cam-alerte-346112.mp3` |
| alerted.wav | Alerted | tones | `Alerted Notification.wav` |
| incoming.wav | Incoming | tones | `Incoming Message2.mp3` |
| newmessage.wav | New Message | tones | `Tomasz_Redman_New-Message-Alert_Main_3sec.mp3` |
| messagealert.wav | Message Alert | tones | `liecio-message-alert-190042.mp3` |
| digital.wav | Digital | tones | `soynoviembre-short-digital-notification-alert-440353.mp3` |
| echo.wav | Echo | tones | `tunetank.com_game-echo-message-alert.wav` |
| softbell.wav | Soft Bell | tones | `universfield-soft-bell-ding-485895.mp3` |
| notify1.wav | Notify 1 | tones | `universfield-new-notification-08-352461.mp3` |
| notify2.wav | Notify 2 | tones | `universfield-new-notification-09-352705.mp3` |
| notify3.wav | Notify 3 | tones | `universfield-new-notification-010-352755.mp3` |
| notify4.wav | Notify 4 | tones | `universfield-new-notification-013-363676.mp3` |
| notify5.wav | Notify 5 | tones | `universfield-new-notification-015-363677.mp3` |
| notify6.wav | Notify 6 | tones | `universfield-new-notification-022-370046.mp3` |

**Licensing:** verify redistribution terms for each source before App Store submission.
