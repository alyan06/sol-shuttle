'use client';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function DayPicker({ label, days, onChange }: { label: string; days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="days" role="group" aria-label={label}>
      {DAYS.map((letter, day) => (
        <button
          key={DAY_NAMES[day]}
          type="button"
          className="day"
          aria-label={DAY_NAMES[day]}
          aria-pressed={days.includes(day)}
          onClick={() => onChange(days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort())}
        >
          {letter}
        </button>
      ))}
    </div>
  );
}

type StepperProps = { value: number; unit: string; min: number; max: number; step?: number; onChange: (value: number) => void; label: string; format?: (value: number) => string };

export function Stepper({ value, unit, min, max, step = 1, onChange, label, format }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="button" aria-label="Less" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        −
      </button>
      <output>{format ? format(value) : `${value} ${unit}`}</output>
      <button type="button" className="button" aria-label="More" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

type SegmentedProps<T extends string | number> = { label: string; options: { value: T; label: string }[]; value: T; onPick: (value: T) => void };

export function Segmented<T extends string | number>({ label, options, value, onPick }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
