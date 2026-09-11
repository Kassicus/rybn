import { z } from "zod";

export const groupDateSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1, "Give this occasion a name").max(200),
  // Matches the occasions.occasion_date column and the 'YYYY-MM-DD' shape
  // celebration_date_in_year() validates on the database side.
  occasionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date (YYYY-MM-DD)"),
});

export type GroupDateInput = z.infer<typeof groupDateSchema>;
