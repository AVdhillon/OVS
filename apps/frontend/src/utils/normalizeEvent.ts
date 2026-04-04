import { isValid } from "date-fns";

export type NormalizedEvent<T = any> = T & {
    start_time: Date;
    end_time: Date;
};

/**
 * Safely converts start_time and end_time into valid Date objects
 * Prevents: RangeError: Invalid time value
 */
export function normalizeEvent<T extends Record<string, any>>(event: T): NormalizedEvent<T> {
    const parseDate = (value: any): Date | null => {
        if (!value) return null;

        // Already a Date
        if (value instanceof Date) {
            return isValid(value) ? value : null;
        }

        // Handle weird cases like {}
        if (typeof value === "object") {
            console.warn("Invalid date object from API:", value);
            return null;
        }

        const d = new Date(value);
        return isValid(d) ? d : null;
    };

    const start = parseDate(event.start_time);
    const end = parseDate(event.end_time);

    // Optional debug logs (VERY useful)
    if (!start) {
        console.warn("Invalid start_time:", event.start_time, event);
    }

    if (!end) {
        console.warn("Invalid end_time:", event.end_time, event);
    }

    return {
        ...event,
        start_time: start,
        end_time: end,
    };
}