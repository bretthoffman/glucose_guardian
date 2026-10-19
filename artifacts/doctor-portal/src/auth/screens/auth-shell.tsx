import type { ReactNode } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { ThemeToggle } from "@/lib/theme";

export function AuthShell({
  title,
  subtitle,
  children,
  width = "max-w-md",
  card = true,
  logoClassName = "w-20 h-20",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  width?: string;
  card?: boolean;
  /** Logo size (the home screen shows it larger). */
  logoClassName?: string;
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/login-bg.svg`}
          alt=""
          aria-hidden="true"
          className="w-full h-full object-cover opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/95 to-background" />
      </div>
      <ThemeToggle className="absolute top-4 right-4 z-20" />
      <div className={`w-full ${width} p-6 relative z-10`}>
        <div className="text-center mb-6">
          <BrandLogo className={`${logoClassName} mx-auto mb-3`} />
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
        </div>
        {card ? (
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-xl">{children}</div>
        ) : (
          <div className="flex flex-col items-center">{children}</div>
        )}
      </div>
    </div>
  );
}
