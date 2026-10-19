export interface LinkedPatient {
  code: string;
  name: string;
  hasData: boolean;
}

/**
 * Doctor's linked patient codes, stored on the device. This is a stopgap until the backend
 * has a doctor-to-patient grant table (see DOCTOR_PORTAL_CANONICAL_BACKEND_SPEC.md §3) — then
 * the linked list comes from the server and is shared across the doctor's devices.
 */
const KEY = "gg_doc_linked";

export function getLinkedPatients(): LinkedPatient[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LinkedPatient[]) : [];
  } catch {
    return [];
  }
}

function save(list: LinkedPatient[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore storage failures */
  }
}

export function addLinkedPatient(entry: LinkedPatient): void {
  const list = getLinkedPatients();
  if (list.some((p) => p.code === entry.code)) return;
  save([entry, ...list]);
}

export function removeLinkedPatient(code: string): void {
  save(getLinkedPatients().filter((p) => p.code !== code));
}
