import { isoUtc } from "../posts/shape"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** X's own form of a time: `Wed Dec 19 20:20:32 +0000 2007`. */
const JOINED_PATTERN = new RegExp(
  `^(?:${WEEKDAYS.join("|")}) (${MONTHS.join("|")}) (\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) ([+-])(\\d{2})(\\d{2}) (\\d{4})$`,
)

const MINUTE_MS = 60_000

/** The limits of a clock time: its hours, minutes and seconds count below these. */
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60

/**
 * The time X writes as `Ddd Mmm DD HH:MM:SS +ZZZZ YYYY`, as ISO 8601 in UTC
 * to the second; null when `text` is not in that form or names a time that
 * does not exist (a 30th of February, a 25th hour, an offset of 99 minutes).
 * It never goes through `Date.parse`, whose reading of this form is the
 * engine's to choose.
 */
export function parseJoined(text: string): string | null {
  const match = JOINED_PATTERN.exec(text)
  if (match === null) return null
  const [monthName, dayText, hourText, minuteText, secondText, sign, offsetHourText, offsetMinuteText, yearText] =
    match.slice(1)
  const [year, day, hour, minute, second, offsetHour, offsetMinute] = [
    yearText,
    dayText,
    hourText,
    minuteText,
    secondText,
    offsetHourText,
    offsetMinuteText,
  ].map(Number)
  const month = MONTHS.indexOf(monthName)
  const wall = Date.UTC(year, month, day, hour, minute, second)
  const date = new Date(wall)
  // A day or a time that does not exist rolls over into the next one, so the date read back differs.
  const exists =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day &&
    hour < HOURS_PER_DAY &&
    minute < MINUTES_PER_HOUR &&
    second < SECONDS_PER_MINUTE &&
    offsetHour < HOURS_PER_DAY &&
    offsetMinute < MINUTES_PER_HOUR
  if (!exists) return null
  const offsetMs = (offsetHour * MINUTES_PER_HOUR + offsetMinute) * MINUTE_MS
  return isoUtc(wall - (sign === "-" ? -offsetMs : offsetMs))
}
