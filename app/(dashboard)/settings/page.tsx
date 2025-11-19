"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Bell, Lock, Mail, CheckCircle, Settings as SettingsIcon } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FormSection } from "@/components/profile/FormSection";
import { GroupTypeSelector } from "@/components/privacy/GroupTypeSelector";
import type { GroupType } from "@/types/privacy";
import {
  getMySettings,
  updateEmailPreferences,
  updatePrivacySettings,
  type EmailPreferences,
  type UserSettings,
} from "@/lib/actions/settings";

export default function SettingsPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoading(true);
      const { data, error } = await getMySettings();
      if (data) {
        setSettings(data);
      }
      if (error) {
        setError(error);
      }
      setIsLoading(false);
    };
    loadSettings();
  }, []);

  const handleEmailPreferenceChange = (key: keyof EmailPreferences, value: boolean) => {
    if (!settings) return;
    setSettings({
      ...settings,
      email_preferences: {
        ...settings.email_preferences,
        [key]: value,
      },
    });
  };

  const handlePrivacyChange = (groupTypes: GroupType[]) => {
    if (!settings) return;
    setSettings({
      ...settings,
      privacy_settings: {
        visible_to_group_types: groupTypes,
      },
    });
  };

  const handleSave = async () => {
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    setSuccess(false);

    // Update email preferences
    const emailResult = await updateEmailPreferences(settings.email_preferences);
    if (emailResult.error) {
      setError(emailResult.error);
      setIsSaving(false);
      return;
    }

    // Update privacy settings
    const privacyResult = await updatePrivacySettings(settings.privacy_settings);
    if (privacyResult.error) {
      setError(privacyResult.error);
      setIsSaving(false);
      return;
    }

    setSuccess(true);
    setIsSaving(false);
    setTimeout(() => setSuccess(false), 3000);
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="max-w-3xl mx-auto space-y-8 p-6">
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <Text variant="error">Failed to load settings. Please try again.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 p-6">
      {/* Header */}
      <div>
        <Heading level="h1" className="flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-primary" />
          Settings
        </Heading>
        <Text variant="secondary" className="mt-2">
          Manage your privacy and notification preferences
        </Text>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
          <Text variant="error">{error}</Text>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          <Text className="text-green-700">Settings saved successfully!</Text>
        </div>
      )}

      {/* Privacy Settings Section */}
      <FormSection
        title="Privacy Settings"
        description="Control who can see your profile information"
      >
        <div className="space-y-4">
          <GroupTypeSelector
            value={settings.privacy_settings.visible_to_group_types as GroupType[]}
            onChange={handlePrivacyChange}
            label="Who can see your profile fields?"
            description="Select which types of groups can view your profile information (sizes, preferences, dates, etc.). Leave all unchecked to keep everything private."
          />
        </div>
      </FormSection>

      <Separator />

      {/* Email Notifications Section */}
      <FormSection
        title="Email Notifications"
        description="Choose which emails you'd like to receive"
      >
        <div className="space-y-4">
          {/* Group Invites */}
          <div className="flex items-start justify-between p-4 rounded-lg border border-light-border hover:bg-light-background transition-colors">
            <div className="flex-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Group Invitations
              </Label>
              <Text variant="secondary" size="sm" className="mt-1">
                Get notified when someone invites you to join a group
              </Text>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.email_preferences.email_group_invites}
                onChange={(e) =>
                  handleEmailPreferenceChange("email_group_invites", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-light rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Date Reminders */}
          <div className="flex items-start justify-between p-4 rounded-lg border border-light-border hover:bg-light-background transition-colors">
            <div className="flex-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Birthday & Anniversary Reminders
              </Label>
              <Text variant="secondary" size="sm" className="mt-1">
                Receive reminders about upcoming birthdays and anniversaries in your groups
              </Text>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.email_preferences.email_date_reminders}
                onChange={(e) =>
                  handleEmailPreferenceChange("email_date_reminders", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-light rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Gift Updates */}
          <div className="flex items-start justify-between p-4 rounded-lg border border-light-border hover:bg-light-background transition-colors">
            <div className="flex-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Group Gift Updates
              </Label>
              <Text variant="secondary" size="sm" className="mt-1">
                Stay informed about group gift contributions and updates
              </Text>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.email_preferences.email_gift_updates}
                onChange={(e) =>
                  handleEmailPreferenceChange("email_gift_updates", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-light rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Gift Exchange Notifications */}
          <div className="flex items-start justify-between p-4 rounded-lg border border-light-border hover:bg-light-background transition-colors">
            <div className="flex-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Gift Exchange & Secret Santa
              </Label>
              <Text variant="secondary" size="sm" className="mt-1">
                Get notified about gift exchange matches, deadlines, and updates
              </Text>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.email_preferences.email_exchange_notifications}
                onChange={(e) =>
                  handleEmailPreferenceChange("email_exchange_notifications", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-light rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Marketing Emails */}
          <div className="flex items-start justify-between p-4 rounded-lg border border-light-border hover:bg-light-background transition-colors">
            <div className="flex-1">
              <Label className="text-base font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Product Updates & Tips
              </Label>
              <Text variant="secondary" size="sm" className="mt-1">
                Receive occasional emails about new features, tips, and Rybn updates
              </Text>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.email_preferences.email_marketing}
                onChange={(e) =>
                  handleEmailPreferenceChange("email_marketing", e.target.checked)
                }
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-light rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
        </div>

        {/* Unsubscribe Warning */}
        <div className="mt-6 p-4 rounded-lg bg-yellow-50 border border-yellow-200">
          <Text size="sm" className="text-yellow-800">
            <strong>Note:</strong> Turning off all email notifications means you won't receive
            any emails from Rybn, including important account and group activity updates. We
            recommend keeping at least group invitations and date reminders enabled.
          </Text>
        </div>
      </FormSection>

      {/* Save Button */}
      <div className="flex gap-3 pt-4 sticky bottom-0 bg-light-background py-4 border-t border-light-border">
        <Button type="button" variant="secondary" onClick={() => router.push("/profile")}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={handleSave}
          loading={isSaving}
          disabled={isSaving}
        >
          <CheckCircle className="w-4 h-4 mr-2" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
