import { UseFormRegister, FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { ProfileEditFormData } from "@/lib/schemas/profile";

interface PersonalInfoSectionProps {
  register: UseFormRegister<ProfileEditFormData>;
  errors: FieldErrors<ProfileEditFormData>;
}

export function PersonalInfoSection({ register, errors }: PersonalInfoSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="dietary_restrictions">Dietary Restrictions</Label>
        <Input
          id="dietary_restrictions"
          {...register("dietary_restrictions")}
          type="text"
          placeholder="e.g., Vegetarian, Gluten-free, Vegan"
          error={errors.dietary_restrictions?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Important for food and restaurant gift cards
        </Text>
      </div>

      <div>
        <Label htmlFor="allergies">Allergies</Label>
        <Input
          id="allergies"
          {...register("allergies")}
          type="text"
          placeholder="e.g., Peanuts, Shellfish, Latex"
          error={errors.allergies?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Help others avoid gifts that could cause allergic reactions
        </Text>
      </div>

      <div>
        <Label htmlFor="coffee_order">Favorite Coffee Order</Label>
        <Input
          id="coffee_order"
          {...register("coffee_order")}
          type="text"
          placeholder="e.g., Grande Latte with oat milk"
          error={errors.coffee_order?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Perfect for coffee gift cards or surprise treats
        </Text>
      </div>

      <div>
        <Label htmlFor="favorite_restaurant">Favorite Restaurant</Label>
        <Input
          id="favorite_restaurant"
          {...register("favorite_restaurant")}
          type="text"
          placeholder="e.g., Olive Garden, Local Pizza Place"
          error={errors.favorite_restaurant?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Great for restaurant gift cards
        </Text>
      </div>

      <div>
        <Label htmlFor="favorite_snacks">Favorite Snacks</Label>
        <Input
          id="favorite_snacks"
          {...register("favorite_snacks")}
          type="text"
          placeholder="e.g., Dark chocolate, Trail mix, Chips"
          error={errors.favorite_snacks?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Your go-to treats and snacks
        </Text>
      </div>
    </div>
  );
}
