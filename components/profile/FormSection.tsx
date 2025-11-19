import { Heading } from "@/components/ui/text";
import { Text } from "@/components/ui/text";

interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({
  title,
  description,
  children,
  className = "",
}: FormSectionProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div>
        <Heading level="h3">{title}</Heading>
        {description && (
          <Text variant="secondary" size="sm" className="mt-1">
            {description}
          </Text>
        )}
      </div>
      <div className="p-6 rounded-lg border border-light-border space-y-4">
        {children}
      </div>
    </div>
  );
}
