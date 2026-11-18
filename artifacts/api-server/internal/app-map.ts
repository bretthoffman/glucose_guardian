/**
 * THE APP MAP — the chat assistant's knowledge of Glucose Guardian itself, so "where is..." and
 * "how do I..." questions get a real answer (a short tap path) instead of "I can't help with that".
 *
 * EXTREMELY LIGHTWEIGHT ON PURPOSE: this string rides EVERY chat message's system prompt (~500
 * tokens on a prompt that already measures ~2,800), and a size-guard test in routes/chat.test.ts
 * fails if it grows past its budget. Its job is WHERE things are plus one clause of what they do;
 * the deep how-to lives in the app's Help Mode, which the last line hands off to. It sits in the
 * prompt's STABLE PREFIX (before the live health snapshot) so OpenAI's automatic prefix caching
 * keeps repeat messages in a conversation close to free.
 *
 * KEEP IN SYNC with the app: hand-distilled from artifacts/mobile/utils/helpScripts.ts (the Help
 * Mode scripts, the maintained inventory of every page). When an update adds, renames or moves
 * something users could ask about, update this map in the same change — it deploys with the next
 * push to master (api auto-deploy), needs no OTA, and reaches every installed app version at once.
 */
export const APP_MAP = `THE APP (Glucose Guardian's own layout. When asked where something is or how to use it, answer with a short tap path, like "Dashboard tab, then Care Circle under Care Team"):
• Bottom tabs: Glucose, Insulin, Food, Chat, Dashboard.
• Glucose: live reading and trend, the graph (3 to 24 hours; its icons are logged doses and meals), the CGM chip (connect or fix Dexcom or Libre, sensor days left), My Shortcuts, recheck timer after a treated low.
• Insulin: the Dose tab is the calculator (live BG, carbs, insulin on board, Predict, "I Just Took This Dose" logs it). The Log tab is the day record: tap an entry to edit or delete it; Add Entry backfills doses, meals and finger sticks. My Insulin tracks open pens and vials with change reminders.
• Food: photo or barcode scan to count carbs, search by name, log meals, Favorites.
• Chat: this assistant. Messages is real people: the doctor thread and care circle threads. History shows past days.
• Dashboard: rows on the page itself: Insulin Settings (carb ratio, target, correction factor, time-of-day overrides). Activity Log. A1C (estimate plus lab results). Shortcuts (the Glucose screen's quick buttons). Under Alerts: Notifications, Alert Thresholds (the low and high lines), Emergency Contacts. Under Care Team: Care Circle (invite a co-guardian, and access codes for grandparents, sitters, the school nurse with school hours, or a Child code for the child's own phone) and Doctor Office (link your doctor with a code; Visit Summary report). Sensor (countdown, New sensor). Care Plan (steps caregivers follow). Day Recap (caregiver's day summary). Handoff (caregiver morning catch-up). What's new. The profile photo at the top opens Settings (profile, light or dark, sign out).
• Child sessions and limited access codes may not see every tab or button.
• Not in this list? Do not guess: suggest Help Mode (Dashboard tab, then the Help button), which walks through every page on the screen. Never invent features or settings.`;
