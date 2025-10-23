import { UseFormRegister, FieldErrors } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { ProfileEditFormData } from "@/lib/schemas/profile";

interface PreferencesSectionProps {
  register: UseFormRegister<ProfileEditFormData>;
  errors: FieldErrors<ProfileEditFormData>;
}

export function PreferencesSection({ register, errors }: PreferencesSectionProps) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="favorite_colors">Favorite Colors</Label>
        <Input
          id="favorite_colors"
          {...register("favorite_colors")}
          type="text"
          placeholder="e.g., Blue, Green, Purple"
          error={errors.favorite_colors?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          List your favorite colors separated by commas
        </Text>
      </div>

      <div>
        <Label htmlFor="favorite_brands">Favorite Brands</Label>
        <Input
          id="favorite_brands"
          {...register("favorite_brands")}
          type="text"
          placeholder="e.g., Nike, Apple, Patagonia"
          error={errors.favorite_brands?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Brands you love and prefer to receive
        </Text>
      </div>

      <div>
        <Label htmlFor="style_preferences">Style Preferences</Label>
        <Input
          id="style_preferences"
          {...register("style_preferences")}
          type="text"
          placeholder="e.g., Casual, Athletic, Modern"
          error={errors.style_preferences?.message}
          className="mt-1"
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Your personal style and fashion preferences
        </Text>
      </div>

      <div>
        <Label htmlFor="hobbies">Hobbies</Label>
        <Textarea
          id="hobbies"
          {...register("hobbies")}
          placeholder="e.g., Photography, Hiking, Reading, Cooking..."
          error={errors.hobbies?.message}
          className="mt-1"
          rows={3}
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Activities you enjoy in your free time
        </Text>
      </div>

      <div>
        <Label htmlFor="interests">Interests</Label>
        <Textarea
          id="interests"
          {...register("interests")}
          placeholder="e.g., Technology, Sports, Art, Music..."
          error={errors.interests?.message}
          className="mt-1"
          rows={3}
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Topics and subjects you're passionate about
        </Text>
      </div>

      <div>
        <Label htmlFor="dislikes">Dislikes</Label>
        <Textarea
          id="dislikes"
          {...register("dislikes")}
          placeholder="Things you'd prefer not to receive..."
          error={errors.dislikes?.message}
          className="mt-1"
          rows={2}
        />
        <Text variant="secondary" size="sm" className="mt-1">
          Help others avoid gifts you wouldn't enjoy
        </Text>
      </div>
    </div>
  );
}
