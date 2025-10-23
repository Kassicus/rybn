import { UseFormRegister, FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { ProfileEditFormData } from "@/lib/schemas/profile";

interface SizesSectionProps {
  register: UseFormRegister<ProfileEditFormData>;
  errors: FieldErrors<ProfileEditFormData>;
}

export function SizesSection({ register, errors }: SizesSectionProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="shoe_size">Shoe Size</Label>
          <Input
            id="shoe_size"
            {...register("shoe_size")}
            type="text"
            placeholder="e.g., 10, 9.5 US"
            error={errors.shoe_size?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="shirt_size">Shirt Size</Label>
          <Input
            id="shirt_size"
            {...register("shirt_size")}
            type="text"
            placeholder="e.g., M, L, XL"
            error={errors.shirt_size?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="pants_size">Pants Size</Label>
          <Input
            id="pants_size"
            {...register("pants_size")}
            type="text"
            placeholder="e.g., 32x34"
            error={errors.pants_size?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="dress_size">Dress Size</Label>
          <Input
            id="dress_size"
            {...register("dress_size")}
            type="text"
            placeholder="e.g., 6, 8, 10"
            error={errors.dress_size?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="ring_size">Ring Size</Label>
          <Input
            id="ring_size"
            {...register("ring_size")}
            type="text"
            placeholder="e.g., 7, 8"
            error={errors.ring_size?.message}
            className="mt-1"
          />
        </div>

        <div>
          <Label htmlFor="hat_size">Hat Size</Label>
          <Input
            id="hat_size"
            {...register("hat_size")}
            type="text"
            placeholder="e.g., 7 1/4"
            error={errors.hat_size?.message}
            className="mt-1"
          />
        </div>
      </div>

      <div className="mt-2">
        <Text variant="secondary" size="sm">
          These sizes help gift-givers choose the perfect fit for you. All sizes are optional.
        </Text>
      </div>
    </div>
  );
}
