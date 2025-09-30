const PART_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

function buildFormatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    ...PART_OPTIONS,
    timeZone,
  });
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const formatter = buildFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value]));

  const localUtcTimestamp = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    Number(lookup.hour),
    Number(lookup.minute),
    Number(lookup.second),
  );

  return (localUtcTimestamp - date.getTime()) / 60_000;
}

export function startOfDayInTimeZone(reference: Date, timeZone: string): Date {
  const utcMidnight = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), 0, 0, 0, 0);
  const utcDate = new Date(utcMidnight);
  const offsetMinutes = getTimeZoneOffsetMinutes(utcDate, timeZone);
  return new Date(utcMidnight - offsetMinutes * 60_000);
}

export function endOfDayInTimeZone(reference: Date, timeZone: string): Date {
  const start = startOfDayInTimeZone(reference, timeZone);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return end;
}

export function addUtcDays(date: Date, days: number): Date {
  const clone = new Date(date);
  clone.setUTCDate(clone.getUTCDate() + days);
  return clone;
}
