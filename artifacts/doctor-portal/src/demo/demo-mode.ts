import { setRequestInterceptor } from "@doctor-portal/api-client-react";
import { demoFetch, resetDemo } from "./server";

/**
 * Demo mode: the portal with sample patients and no account. While it's on, every API request is
 * answered in the browser (server.ts), so the demo can't reach — or show — real patient data.
 * The flag lives in sessionStorage, so a reload stays in the demo and closing the tab ends it.
 */
const FLAG = "gg_demo";

function flagged(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function startDemo(): void {
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    /* still runs for this page load */
  }
  setRequestInterceptor(demoFetch);
}

/** On page load: pick the demo back up if this tab was in it. */
export function resumeDemo(): boolean {
  if (!flagged()) return false;
  setRequestInterceptor(demoFetch);
  return true;
}

export function stopDemo(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
  setRequestInterceptor(null);
  resetDemo();
}
