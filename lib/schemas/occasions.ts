import { z } from "zod";

export const groupDateSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1, "Give this occasion a name").max(200),
  // Matches the occasions.occasion_date column's 'YYYY-MM-DD' shape.
  // occasion_date is a plain `date` column -- Postgres' own cast is what
  // validates it on the database side. celebration_date_in_year() never
  // sees a group date at all; it only ever runs over derived birthday/
  // anniversary values from profile_info.
  occasionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date (YYYY-MM-DD)"),
});

export type GroupDateInput = z.infer<typeof groupDateSchema>;
