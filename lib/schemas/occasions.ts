import { z } from "zod";
import { isCalendarDay } from "@/lib/utils/dates";

/** The sentences the group date actions answer for a name or a date they refuse. */
export const GROUP_DATE_RULES = {
  name: "Give this occasion a name",
  nameTooLong: "Keep the name to 200 characters or fewer.",
  date: "Please enter a valid date (YYYY-MM-DD)",
} as const;

export const groupDateSchema = z.object({
  groupId: z.string().uuid(),
  // Counted after trimming; the occasions table holds at most 200 (occasion_name_length).
  name: z.string().trim().min(1, GROUP_DATE_RULES.name).max(200, GROUP_DATE_RULES.nameTooLong),
  // Matches the occasions.occasion_date column's 'YYYY-MM-DD' shape, and must
  // name a day on the calendar (2026-02-30 is refused here, not by the
  // database's own cast). occasion_date is a plain `date` column.
  // celebration_date_in_year() never sees a group date at all; it only ever
  // runs over derived birthday/anniversary values from profile_info.
  occasionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, GROUP_DATE_RULES.date)
    .refine(isCalendarDay, GROUP_DATE_RULES.date),
});

export type GroupDateInput = z.infer<typeof groupDateSchema>;
