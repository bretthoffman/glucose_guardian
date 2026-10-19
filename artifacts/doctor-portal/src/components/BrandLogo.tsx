/**
 * The Glucose Guardian brand mark — the same winged-shield logo used in the mobile app
 * (public/images/logo.png, transparent PNG so it sits on any background). Use everywhere the
 * portal shows its identity so app and portal stay visually in sync.
 */
export function BrandLogo({ className = "w-9 h-9" }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}images/logo.png`}
      alt="Glucose Guardian"
      className={`${className} object-contain shrink-0`}
    />
  );
}
