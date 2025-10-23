import { UseFormRegister, FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { ProfileEditFormData } from "@/lib/schemas/profile";

interface DatesSectionProps {
  register: UseFormRegister<ProfileEditFormData>;
  errors: FieldErrors<ProfileEditFormData>;
}

export function DatesSection({ register, errors }: DatesSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="birthday">Birthday</Label>
        <Input
          id="birthday"
          {...register("birthday")}
          type="date"
          error={errors.birthday?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Your date of birth (YYYY-MM-DD)
        </Text>
      </div>

      <div>
        <Label htmlFor="anniversary">Anniversary</Label>
        <Input
          id="anniversary"
          {...register("anniversary")}
          type="date"
          error={errors.anniversary?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Wedding anniversary or other important date
        </Text>
      </div>

      <div className="mt-2">
        <Text variant="secondary" size="sm">
          Important dates help your group remember to celebrate special occasions with you.
        </Text>
      </div>
    </div>
  );
}
