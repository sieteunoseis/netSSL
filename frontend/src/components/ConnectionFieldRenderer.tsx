/**
 * Shared field renderer for connection forms.
 * Extracted from EditConnectionModalTabbed's renderField().
 * Used by both Add and Edit modals.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { FieldDefinition } from "@/lib/connection-fields";

interface ConnectionFieldRendererProps {
  field: FieldDefinition;
  value: any;
  error?: string;
  onChange: (name: string, value: any) => void;
  onSelectChange?: (name: string, value: string) => void;
  onTextareaChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onInputChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCsrGenerateClick?: () => void;
  applicationType?: string;
}

export default function ConnectionFieldRenderer({
  field,
  value,
  error,
  onChange,
  onSelectChange,
  onTextareaChange,
  onInputChange,
  onCsrGenerateClick,
  applicationType,
}: ConnectionFieldRendererProps) {
  const isOptional = field.optional === true;
  const label = field.label;
  const placeholder = field.placeholder || (isOptional ? `${label} (Optional)` : label);

  // INFO type — display-only
  if (field.type === 'info') {
    return (
      <div key={field.name} className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          {field.description}
        </p>
      </div>
    );
  }

  // SWITCH type
  if (field.type === 'switch') {
    return (
      <div key={field.name} className="space-y-2">
        <div className="flex items-start space-x-3">
          <Switch
            id={field.name}
            checked={Boolean(value)}
            onCheckedChange={(checked) => onChange(field.name, checked)}
            className="mt-1"
          />
          <div className="space-y-1">
            <Label htmlFor={field.name} className="text-sm font-medium cursor-pointer">
              {label}
            </Label>
            {field.description && (
              <p className="text-xs text-muted-foreground">
                {field.description}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // SELECT type
  if (field.type === 'select') {
    const selectValue = String(value !== undefined && value !== null ? value : (field.defaultValue || ''));
    return (
      <div key={field.name} className="space-y-2">
        <Label>{label}</Label>
        <Select
          key={`${field.name}-${selectValue}`}
          value={selectValue}
          onValueChange={(v) => onSelectChange ? onSelectChange(field.name, v) : onChange(field.name, v)}
        >
          <SelectTrigger>
            <SelectValue placeholder={placeholder}>
              {field.selectOptions?.find(opt => opt.value === selectValue)?.label || selectValue}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="item-aligned">
            {field.selectOptions?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error && <span className="text-red-500 font-semibold">{error}</span>}
      </div>
    );
  }

  // TEXTAREA type
  if (field.type === 'textarea') {
    const showCsrButton = (field.name === 'custom_csr' || field.name === 'ise_certificate') &&
      (applicationType === 'general' || applicationType === 'ise' || applicationType === 'catalyst_center');

    return (
      <div key={field.name} className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          {showCsrButton && onCsrGenerateClick && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCsrGenerateClick}
            >
              Generate CSR
            </Button>
          )}
        </div>
        <Textarea
          required={!isOptional}
          name={field.name}
          placeholder={placeholder}
          value={String(value || '')}
          rows={field.rows || 6}
          autoComplete="off"
          data-lpignore="true"
          data-form-type="other"
          data-1p-ignore="true"
          className="resize-none"
          onChange={onTextareaChange}
        />
        {error && <span className="text-red-500 font-semibold">{error}</span>}
      </div>
    );
  }

  // TEXT / PASSWORD type (default)
  const inputType = field.type === 'password' || field.name === 'password' || field.name === 'pw'
    ? 'password'
    : 'text';

  return (
    <div key={field.name} className="space-y-2">
      <Label>{label}</Label>
      <Input
        required={!isOptional}
        type={inputType}
        name={field.name}
        placeholder={placeholder}
        value={String(value || '')}
        autoComplete="off"
        data-lpignore="true"
        data-form-type="other"
        data-1p-ignore="true"
        onChange={onInputChange}
      />
      {error && <span className="text-red-500 font-semibold">{error}</span>}
    </div>
  );
}
