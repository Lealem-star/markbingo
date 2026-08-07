/** Ethiopian traditional clock is 6 hours behind the phone clock (EAT). */
export const ETHIOPIAN_TIME_OFFSET_HOURS = 6;

/** Super Bingo daily start on the phone clock — must match backend SUPER_DAILY_START_HOUR. */
export const SUPER_BINGO_START_HOUR_EAT = 17;

function getEatHourMinute(ms) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Addis_Ababa',
        hour: 'numeric',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(ms));

    return {
        hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
        minute: parts.find((p) => p.type === 'minute')?.value ?? '00',
    };
}

function toEthiopianHour(eatHour) {
    let ethHour = eatHour - ETHIOPIAN_TIME_OFFSET_HOURS;
    if (ethHour < 0) ethHour += 24;
    return ethHour;
}

function ethiopianPeriodPrefix(ethHour) {
    if (ethHour >= 6 && ethHour <= 11) return 'ከቀኑ';
    if (ethHour >= 1 && ethHour <= 5) return 'ከጠዋት';
    return 'ከማታ';
}

function formatEthiopianDisplayHour(ethHour) {
    return ethHour === 0 ? 12 : ethHour;
}

/** Format a UTC/ms timestamp as Ethiopian traditional time for UI labels. */
export function formatEthiopianTraditionalTime(ms) {
    const { hour, minute } = getEatHourMinute(ms);
    const ethHour = toEthiopianHour(hour);
    const period = ethiopianPeriodPrefix(ethHour);
    const displayHour = formatEthiopianDisplayHour(ethHour);
    return `${period}: ${displayHour}:${minute} ሰዓት`;
}

/** Daily Super Bingo schedule label, e.g. "ዘወትር ከቀኑ: 11:00 ሰዓት". */
export function formatSuperBingoScheduleLabel(scheduledStartAt) {
    if (scheduledStartAt) {
        return `ዘወትር ${formatEthiopianTraditionalTime(scheduledStartAt)}`;
    }

    const ethHour = toEthiopianHour(SUPER_BINGO_START_HOUR_EAT);
    const period = ethiopianPeriodPrefix(ethHour);
    const displayHour = formatEthiopianDisplayHour(ethHour);
    return `ዘወትር ${period}: ${displayHour}:00 ሰዓት`;
}
