/**
 * Display formatting only. Values arrive from the API already converted to display units and rounded; nothing here
 * changes their meaning, and a missing value is always shown as "Unavailable", never as zero.
 */
export const UNAVAILABLE = 'Unavailable';

const MINUS = '−';
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Maybe = number | null | undefined;

function signed(value: number): string {
  const text = numberFormat.format(Math.abs(value));
  return value < 0 && Number(text.replace(/,/g, '')) !== 0 ? `${MINUS}${text}` : text;
}

export const formatNumber = (value: Maybe): string => (value == null ? UNAVAILABLE : signed(value));
export const formatPercent = (value: Maybe): string => (value == null ? UNAVAILABLE : `${signed(value)}%`);
export const formatPoints = (value: Maybe): string => (value == null ? UNAVAILABLE : numberFormat.format(value));
export const formatPassengers = (value: Maybe): string => (value == null ? UNAVAILABLE : integerFormat.format(value));
export const formatMinutes = (value: Maybe): string => (value == null ? UNAVAILABLE : `${signed(value)} min`);
export const formatHours = (value: Maybe): string => (value == null ? UNAVAILABLE : `${numberFormat.format(value)} h`);
export const formatPercentile = (value: Maybe): string => (value == null ? UNAVAILABLE : `${numberFormat.format(value)} percentile`);

/** Formats a value that carries its own unit label from the API ("percent", "percentage points", "passengers", ...). */
export function formatWithUnit(value: Maybe, unit: string): string {
  if (value == null) return UNAVAILABLE;
  switch (unit) {
    case 'percent':
      return formatPercent(value);
    case 'percentage points':
      return `${signed(value)} pp`;
    case 'passengers':
      return integerFormat.format(value);
    default:
      return unit ? `${signed(value)} ${unit}` : signed(value);
  }
}

function monthLabel(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const name = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && name ? `${name} ${match[1]}` : null;
}

export function formatPeriod(period: { start: string; end: string } | null | undefined): string {
  if (!period) return UNAVAILABLE;
  const start = monthLabel(period.start);
  const end = monthLabel(period.end);
  return start && end ? `${start} – ${end}` : `${period.start} to ${period.end}`;
}

const utc = (iso: string): string => iso.replace('T', ' ').replace(/:00(\.\d+)?Z$/, '').replace(/Z$/, '');

export function formatUtcWindow(window: { start: string; end: string } | null | undefined): string {
  return window ? `${utc(window.start)} – ${utc(window.end)} UTC` : UNAVAILABLE;
}

export function formatLocalWindow(window: { from: string; to: string }): string {
  return `${window.from.replace('T', ' ')} – ${window.to.replace('T', ' ')} local`;
}
