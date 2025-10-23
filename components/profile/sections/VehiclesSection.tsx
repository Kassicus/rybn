import { UseFormRegister, FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { ProfileEditFormData } from "@/lib/schemas/profile";

interface VehiclesSectionProps {
  register: UseFormRegister<ProfileEditFormData>;
  errors: FieldErrors<ProfileEditFormData>;
}

export function VehiclesSection({ register, errors }: VehiclesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="vehicle_make">Make</Label>
          <Input
            id="vehicle_make"
            {...register("vehicle_make")}
            type="text"
            placeholder="e.g., Toyota"
            error={errors.vehicle_make?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="vehicle_model">Model</Label>
          <Input
            id="vehicle_model"
            {...register("vehicle_model")}
            type="text"
            placeholder="e.g., Camry"
            error={errors.vehicle_model?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="vehicle_year">Year</Label>
          <Input
            id="vehicle_year"
            {...register("vehicle_year")}
            type="text"
            placeholder="e.g., 2020"
            error={errors.vehicle_year?.message}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="vehicle_accessories_needed">Accessories Needed</Label>
        <Input
          id="vehicle_accessories_needed"
          {...register("vehicle_accessories_needed")}
          type="text"
          placeholder="e.g., Floor mats, phone mount, dash cam..."
          error={errors.vehicle_accessories_needed?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          List vehicle accessories or upgrades you'd like
        </Text>
      </div>

      <div className="mt-2">
        <Text variant="secondary" size="sm">
          Vehicle information helps others suggest practical car-related gifts like accessories or maintenance items.
        </Text>
      </div>
    </div>
  );
}
