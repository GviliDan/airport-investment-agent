import { z } from 'zod';

export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be formatted YYYY-MM')
  .brand<'YearMonth'>();
export type YearMonth = z.infer<typeof YearMonthSchema>;

/** Inclusive range of calendar months. */
export const PeriodSchema = z
  .object({ start: YearMonthSchema, end: YearMonthSchema })
  .refine((p) => p.start <= p.end, { message: 'Period start must not be after its end' });
export type Period = z.infer<typeof PeriodSchema>;

export function monthsInPeriod(period: Period): YearMonth[] {
  const months: YearMonth[] = [];
  let [year, month] = splitYearMonth(period.start);
  const [endYear, endMonth] = splitYearMonth(period.end);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push(toYearMonth(year, month));
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** The `count` consecutive months ending at `end`, as a period. */
export function trailingPeriod(end: YearMonth, count: number): Period {
  if (!Number.isInteger(count) || count < 1) throw new RangeError('count must be a positive integer');
  const [endYear, endMonth] = splitYearMonth(end);
  const index = endYear * 12 + (endMonth - 1) - (count - 1);
  return PeriodSchema.parse({ start: toYearMonth(Math.floor(index / 12), (index % 12) + 1), end });
}

/** The period of equal length that ends the month before `period` starts. */
export function precedingPeriod(period: Period): Period {
  const length = monthsInPeriod(period).length;
  const [year, month] = splitYearMonth(period.start);
  const index = year * 12 + (month - 1) - 1;
  return trailingPeriod(toYearMonth(Math.floor(index / 12), (index % 12) + 1), length);
}

function splitYearMonth(value: YearMonth): [number, number] {
  const [year = '', month = ''] = value.split('-');
  return [Number(year), Number(month)];
}

function toYearMonth(year: number, month: number): YearMonth {
  return YearMonthSchema.parse(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`);
}
