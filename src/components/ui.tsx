/**
 * Shared UI primitives for the console.
 *
 * Everything is built from plain Tailwind + the theme tokens in index.css so
 * there is no component-library dependency, and every control is sized for a
 * 390px-wide phone first (>=44px touch targets) before being widened on
 * desktop.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./Icon";
import type { RiskLevel } from "../core/types";

/* ------------------------------------------------------------------ layout */

export function Panel({
  children,
  className = "",
  solid = false,
}: {
  children: ReactNode;
  className?: string;
  solid?: boolean;
}) {
  return <div className={`${solid ? "panel-solid" : "panel"} ${className}`}>{children}</div>;
}

export function SectionHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <Icon name={icon} className="h-4 w-4 text-accent-soft" /> : null}
          <h2 className="truncate text-[13px] font-semibold uppercase tracking-[0.16em] text-white/55">
            {title}
          </h2>
        </div>
        {subtitle ? <p className="mt-1 text-sm text-white/60">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "danger" | "info" | "accent";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-white/12 bg-white/[0.05] text-white/70",
    ok: "border-emerald-400/25 bg-emerald-500/12 text-emerald-200",
    warn: "border-amber-400/25 bg-amber-500/12 text-amber-200",
    danger: "border-rose-400/25 bg-rose-500/12 text-rose-200",
    info: "border-sky-400/25 bg-sky-500/12 text-sky-200",
    accent: "border-accent/40 bg-accent/15 text-accent-soft",
  };
  return <span className={`chip ${tones[tone]} ${className}`}>{children}</span>;
}

export function RiskBadge({ level, className = "" }: { level: RiskLevel; className?: string }) {
  const tone = level === "CRITICAL" ? "danger" : level === "HIGH" ? "warn" : level === "MEDIUM" ? "info" : "ok";
  return (
    <Badge tone={tone} className={className}>
      <span className="font-mono text-[10px] tracking-widest">{level}</span>
    </Badge>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: "ok" | "warn" | "danger" | "idle"; pulse?: boolean }) {
  const colors: Record<string, string> = {
    ok: "bg-signal-ok",
    warn: "bg-signal-warn",
    danger: "bg-signal-danger",
    idle: "bg-white/30",
  };
  return (
    <span className="relative inline-flex h-2.5 w-2.5">
      {pulse ? (
        <span className={`absolute inset-0 animate-pulse-ring rounded-full ${colors[tone]}`} />
      ) : null}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${colors[tone]}`} />
    </span>
  );
}

/* ----------------------------------------------------------------- buttons */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger" | "quiet";
  icon?: IconName;
  block?: boolean;
}

export function Button({
  variant = "ghost",
  icon,
  block = false,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const variants = {
    primary: "btn-primary",
    ghost: "btn-ghost",
    danger: "btn-danger",
    quiet: "btn-quiet",
  } as const;
  return (
    <button
      {...rest}
      className={`${variants[variant]} ${block ? "w-full" : ""} ${className}`}
    >
      {icon ? <Icon name={icon} className="h-[18px] w-[18px]" /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.09] hover:text-white active:scale-95 disabled:opacity-40 ${className}`}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </button>
  );
}

/* ---------------------------------------------------------------- progress */

export function Meter({
  value,
  tone = "accent",
  className = "",
  height = 6,
}: {
  value: number;
  tone?: "accent" | "ok" | "warn" | "danger";
  className?: string;
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const tones: Record<string, string> = {
    accent: "from-accent to-accent-soft",
    ok: "from-emerald-500 to-emerald-300",
    warn: "from-amber-500 to-amber-300",
    danger: "from-rose-600 to-rose-400",
  };
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-white/[0.07] ${className}`}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full bg-gradient-to-r ${tones[tone]} transition-[width] duration-500 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Gauge({
  value,
  label,
  sublabel,
  tone = "accent",
  size = 96,
}: {
  value: number;
  label: string;
  sublabel?: string;
  tone?: "accent" | "ok" | "warn" | "danger";
  size?: number;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const colors: Record<string, string> = {
    accent: "#a06bff",
    ok: "#3ddc97",
    warn: "#ffb454",
    danger: "#ff5d6c",
  };
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={colors[tone]}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
            className="transition-[stroke-dashoffset] duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="mono text-lg font-semibold text-white">{Math.round(pct)}%</span>
        </div>
      </div>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">{label}</p>
      {sublabel ? <p className="mono text-[11px] text-white/40">{sublabel}</p> : null}
    </div>
  );
}

export function Sparkline({
  values,
  tone = "accent",
  height = 40,
  className = "",
  max,
}: {
  values: number[];
  tone?: "accent" | "ok" | "warn" | "danger" | "info";
  height?: number;
  className?: string;
  max?: number;
}) {
  const colors: Record<string, string> = {
    accent: "#a06bff",
    ok: "#3ddc97",
    warn: "#ffb454",
    danger: "#ff5d6c",
    info: "#5db8ff",
  };
  if (values.length < 2) {
    return <div className={`h-[${height}px] ${className}`} style={{ height }} />;
  }
  const upper = max ?? Math.max(...values, 1);
  const width = 100;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - (Math.max(0, Math.min(upper, v)) / upper) * (height - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const path = `M${points.join(" L")}`;
  const area = `${path} L${width},${height} L0,${height} Z`;
  const gradientId = `spark-${tone}-${values.length}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors[tone]} stopOpacity="0.35" />
          <stop offset="100%" stopColor={colors[tone]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={colors[tone]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-white/40">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            value === option.value
              ? "bg-accent/25 text-white shadow-[inset_0_0_0_1px_rgba(160,107,255,0.4)]"
              : "text-white/50 hover:text-white/80"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-accent/50 bg-accent/40" : "border-white/12 bg-white/[0.06]"
      }`}
    >
      <span
        className="inline-block rounded-full bg-white transition-transform duration-150"
        style={{ height: 18, width: 18, transform: `translateX(${checked ? 22 : 4}px)` }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------- sheet */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  size = "auto",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "auto" | "tall";
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative z-10 w-full animate-fade-up overflow-hidden rounded-t-3xl border border-white/10 bg-[rgb(var(--panel))] shadow-2xl sm:max-w-lg sm:rounded-2xl ${
          size === "tall" ? "max-h-[92vh]" : "max-h-[85vh]"
        } flex flex-col`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
          <h3 id={titleId} className="text-base font-semibold text-white">
            {title}
          </h3>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        <div className="scroll-area flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="safe-bottom border-t border-white/[0.07] px-5 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  command,
  risk,
  confirmLabel = "Approve",
  confirmVariant = "primary",
  irreversible = false,
  extraActions,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  command?: string;
  risk?: RiskLevel;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  irreversible?: boolean;
  extraActions?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant={confirmVariant} block onClick={onConfirm}>
            {confirmLabel}
          </Button>
          {extraActions}
          <Button variant="quiet" block onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {risk ? (
          <div className="flex items-center gap-2">
            <RiskBadge level={risk} />
            {irreversible ? (
              <Badge tone="danger">
                <Icon name="alert" className="h-3.5 w-3.5" /> irreversible
              </Badge>
            ) : null}
          </div>
        ) : null}
        <div className="text-sm text-white/75">{description}</div>
        {command ? (
          <pre className="mono overflow-x-auto rounded-xl border border-white/10 bg-black/60 p-3 text-[12.5px] text-accent-soft">
            <code>{command}</code>
          </pre>
        ) : null}
        {irreversible ? (
          <p className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-[13px] text-rose-200">
            This action cannot be undone and can only be approved once — session-wide approval is
            disabled for irreversible operations.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------------- misc */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-accent-soft">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white/85">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-[13px] text-white/50">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: IconName;
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
}) {
  const toneRing: Record<string, string> = {
    neutral: "text-white/70",
    ok: "text-emerald-300",
    warn: "text-amber-300",
    danger: "text-rose-300",
    accent: "text-accent-soft",
  };
  return (
    <div className="panel px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
          {label}
        </span>
        {icon ? <Icon name={icon} className={`h-4 w-4 ${toneRing[tone]}`} /> : null}
      </div>
      <div className="mono mt-1.5 text-xl font-semibold leading-none text-white">{value}</div>
      {sub ? <div className="mono mt-1 text-[11px] text-white/40">{sub}</div> : null}
    </div>
  );
}

export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [copied, copy];
}

export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 5_000) return "now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
