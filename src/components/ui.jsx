import React from 'react';
import { motion } from 'framer-motion';
import { cn } from 'cn';
import { buttonVariants } from './ui/button.jsx';
import { Card as CardBase } from './ui/card.jsx';
import { Input as InputBase } from './ui/input.jsx';
import { Textarea as TextareaBase } from './ui/textarea.jsx';
import { Label as LabelBase } from './ui/label.jsx';
import { Switch } from './ui/switch.jsx';
import { Progress } from './ui/progress.jsx';
import { Badge } from './ui/badge.jsx';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from './ui/dialog.jsx';

const BTN_VARIANT = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive', outline: 'outline' };
const BTN_SIZE = { sm: 'sm', md: 'default', lg: 'lg' };

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  return (
    <button
      className={cn(
        buttonVariants({ variant: BTN_VARIANT[variant] || 'default', size: BTN_SIZE[size] || 'default' }),
        'cursor-pointer transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1',
        variant === 'primary' &&
          'border border-white/20 bg-gradient-to-b from-accent to-[hsl(215,88%,48%)] text-white shadow-xs hover:brightness-110 active:brightness-95 active:translate-y-px',
        variant === 'secondary' &&
          'border border-line-strong bg-surface-2/60 text-t1 shadow-xs hover:bg-surface-2 hover:border-line-strong active:bg-surface-2/90 active:translate-y-px',
        variant === 'ghost' &&
          'text-t2 hover:bg-surface-2/70 hover:text-t1 active:bg-surface-2',
        variant === 'danger' &&
          'border border-err/30 bg-err/10 text-err hover:bg-err/20 active:bg-err/25',
        size === 'lg' && 'h-11 px-5 text-[14px]',
        className
      )}
      {...props}
    />
  );
}

export function Card({ className = '', hover = false, ...props }) {
  return <CardBase className={cn('card gap-0 py-0', hover && 'card-hover', className)} {...props} />;
}

export function GlassPanel({ className = '', ...props }) {
  return <div className={cn('glass rounded-2xl', className)} {...props} />;
}

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute -top-40 right-[-10%] h-[520px] w-[720px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--mv-ambient-1), transparent 70%)' }}
      />
      <div
        className="absolute bottom-[-30%] left-[-8%] h-[480px] w-[640px] rounded-full opacity-60 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, var(--mv-ambient-2), transparent 70%)' }}
      />
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, actions }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-accent-soft shadow-xs">
            <Icon className="text-accent-text" style={{ width: 15, height: 15 }} />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-t1">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-t3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <InputBase
      className={cn(
        'h-9 rounded-lg border border-line-strong bg-surface-2/40 text-sm text-t1 placeholder:text-t3/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25',
        className
      )}
      {...props}
    />
  );
}

export function Textarea({ className = '', ...props }) {
  return (
    <TextareaBase
      className={cn(
        'rounded-lg border border-line-strong bg-surface-2/40 font-mono text-[13px] text-t1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25',
        className
      )}
      {...props}
    />
  );
}

export function Label({ children, className = '', ...props }) {
  return (
    <LabelBase className={cn('mb-1.5 block text-xs font-medium text-t2', className)} {...props}>
      {children}
    </LabelBase>
  );
}

export function Select({ className = '', children, ...props }) {
  return (
    <select
      className={cn(
        'h-9 w-full cursor-pointer rounded-lg border border-line-strong bg-surface-2/40 px-3 text-[13px] text-t1 transition-all outline-none focus:border-accent/70 focus:bg-surface focus:ring-2 focus:ring-accent/25 disabled:opacity-50 [&>option]:bg-surface [&>option]:text-t1',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

const CAP_STYLES = {
  supported: { label: 'Supported', cls: 'border-ok/35 bg-ok/10 text-ok', dot: 'bg-ok shadow-[0_0_6px_var(--mv-ok)]' },
  partial: { label: 'Partial', cls: 'border-warn/35 bg-warn/10 text-warn', dot: 'bg-warn shadow-[0_0_6px_var(--mv-warn)]' },
  requires_auth: { label: 'Auth required', cls: 'border-info/35 bg-info/10 text-info', dot: 'bg-info shadow-[0_0_6px_var(--mv-info)]' },
  unsupported: { label: 'Not supported', cls: 'border-line bg-surface-2/60 text-t3', dot: 'bg-t3' }
};

export function CapBadge({ value }) {
  const s = CAP_STYLES[value] || CAP_STYLES.unsupported;
  return (
    <Badge variant="outline" className={cn('h-auto rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-xs', s.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </Badge>
  );
}

export const STATUS_META = {
  waiting: { label: 'Waiting', cls: 'border-line bg-surface-2/70 text-t2', dot: 'bg-t3' },
  fetching_metadata: { label: 'Metadata', cls: 'border-info/35 bg-info/10 text-info font-medium', dot: 'bg-info shadow-[0_0_6px_var(--mv-info)] animate-pulse' },
  downloading: { label: 'Downloading', cls: 'border-accent/35 bg-accent-soft text-accent-text font-medium', dot: 'bg-accent shadow-[0_0_6px_var(--mv-accent)] pulse-dot' },
  processing: { label: 'Processing', cls: 'border-accent-2/35 bg-accent-2/10 text-accent-2 font-medium', dot: 'bg-accent-2 shadow-[0_0_6px_var(--mv-accent-2)] pulse-dot' },
  completed: { label: 'Completed', cls: 'border-ok/35 bg-ok/10 text-ok font-medium', dot: 'bg-ok shadow-[0_0_6px_var(--mv-ok)]' },
  failed: { label: 'Failed', cls: 'border-err/35 bg-err/10 text-err font-medium', dot: 'bg-err shadow-[0_0_6px_var(--mv-err)]' },
  cancelled: { label: 'Cancelled', cls: 'border-line bg-surface-2/50 text-t3', dot: 'bg-t3' }
};

export function StatusBadge({ status }) {
  const s = STATUS_META[status] || STATUS_META.waiting;
  return (
    <Badge variant="outline" className={cn('h-auto rounded-full px-2.5 py-0.5 text-[11px] shadow-xs', s.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
      {s.label}
    </Badge>
  );
}

export function ProgressBar({ value, indeterminate = false, active = false, className = '' }) {
  if (indeterminate) {
    return (
      <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2 border border-line/40', className)}>
        <motion.div
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-accent via-accent-2 to-accent shadow-[0_0_8px_var(--mv-accent)]"
          animate={{ x: ['-120%', '420%'] }}
          transition={{ repeat: Infinity, ease: 'easeInOut', duration: 1.4 }}
        />
      </div>
    );
  }
  return (
    <Progress
      value={Math.round(Math.min(1, Math.max(0, value || 0)) * 100)}
      className={cn('h-1.5 border border-line/30', active && 'shimmer', className)}
    />
  );
}

export function Spinner({ className = '' }) {
  return (
    <div
      className={cn('h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

const STAT_TONES = {
  accent: 'bg-accent-soft text-accent-text border-accent/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-err/10 text-err border-err/25',
  info: 'bg-info/10 text-info border-info/25',
  neutral: 'bg-surface-2 text-t2 border-line'
};

export function Stat({ label, value, sub, icon: Icon, tone = 'accent' }) {
  return (
    <Card hover className="fade-up px-5 py-4">
      <div className="flex items-center justify-between">
        <p className="overline">{label}</p>
        {Icon && (
          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg border shadow-xs', STAT_TONES[tone])}>
            <Icon style={{ width: 15, height: 15 }} />
          </div>
        )}
      </div>
      <p className="mt-2.5 text-[28px] font-semibold leading-none tracking-tight text-t1 tabular-nums">{value}</p>
      {sub && <p className="mt-2 truncate text-xs text-t3">{sub}</p>}
    </Card>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }) {
  return (
    <div className="fade-up flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2/20 py-12 px-6 text-center">
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-accent-soft shadow-xs">
          <Icon className="text-accent-text" style={{ width: 22, height: 22 }} />
        </div>
      )}
      <div>
        <p className="text-sm font-semibold tracking-tight text-t1">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-t3">{hint}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 select-none">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-t1">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-t3">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 h-5 w-9" />
    </label>
  );
}

/**
 * Confirmation dialog on the Radix Dialog primitive (focus trap, Escape,
 * outside-click) with the app's surface styling and data-theme-aware colors.
 */
export function AnimatedDialog({ open, onClose, title, children, footer, width = 440 }) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="gap-0 p-0 border border-line-strong bg-surface shadow-2xl" style={{ maxWidth: width }} showCloseButton>
        <DialogHeader className="items-center justify-between border-b border-line px-5 py-3.5">
          <DialogTitle className="text-sm font-semibold text-t1">{title}</DialogTitle>
        </DialogHeader>
        <DialogDescription className="sr-only">Dialog</DialogDescription>
        <div className="px-5 py-4 text-sm text-t2">{children}</div>
        {footer && <DialogFooter className="rounded-b-xl border-t border-line bg-surface-2/40 px-5 py-3">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
