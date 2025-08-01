import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';
import CSRGeneratorWizard from './CSRGeneratorWizard';

interface Column {
  name: string;
  type: string;
  optional?: boolean;
  label?: string;
  placeholder?: string;
  default?: string | boolean;
  description?: string;
  options?: { value: string; label: string }[];
  allowCustom?: boolean;
  conditional?: {
    field: string;
    value: string | boolean;
  };
  conditionalMultiple?: {
    field: string;
    values: (string | boolean)[];
  }[];
  conditionalNot?: {
    field: string;
    value: string | boolean;
  };
  validator?: {
    name: keyof typeof validator;
    options?: unknown;
  };
}

interface DataFormProps {
  onDataAdded: () => void;
  fields?: Column[];
  onFormDataChange?: (data: Record<string, string | boolean>) => void;
  sharedFormData?: Record<string, string | boolean>;
  isPartOfTabbedForm?: boolean;
}

const DataForm: React.FC<DataFormProps> = ({ 
  onDataAdded, 
  fields, 
  onFormDataChange,
  sharedFormData,
  isPartOfTabbedForm = false
}) => {
  const { toast } = useToast();
  const [data, setData] = useState<Column[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isCSRWizardOpen, setIsCSRWizardOpen] = useState(false);

  const object = data.reduce((obj: Record<string, string | boolean>, value) => {
    obj[value.name] = value.default || (value.type === "SWITCH" ? false : "");
    return obj;
  }, {});
  const [formData, setFormData] = useState<Record<string, string | boolean>>(sharedFormData || object);

  useEffect(() => {
    if (fields) {
      setData(fields);
    } else {
      const fetchData = async () => {
        const response = await fetch("/dbSetup.json"); // Note the leading '/'
        const jsonData: Column[] = await response.json();
        setData(jsonData);
        
        // Initialize form data with default values
        const initialData = jsonData.reduce((obj: Record<string, string | boolean>, value) => {
          obj[value.name] = value.default !== undefined ? value.default : (value.type === "SWITCH" ? false : "");
          return obj;
        }, {});
        if (!sharedFormData) {
          setFormData(initialData);
        }
      };

      fetchData();
    }
  }, [fields, sharedFormData]);

  // Sync with shared form data
  useEffect(() => {
    if (sharedFormData) {
      setFormData(sharedFormData);
    }
  }, [sharedFormData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, options: Column['validator'], isOptional = false) => {
    const { name, value } = e.target;
    const newErrors: Record<string, string> = {};

    // Validate - skip validation if field is optional and empty or if no validator is provided
    if (options && (value.trim() !== '' || !isOptional)) {
      try {
        const validatorFn = validator[options.name] as (value: string, options?: unknown) => boolean;
        if (validatorFn && !validatorFn(value, options.options)) {
          if (name === 'hostname') {
            newErrors[name] = "Invalid hostname - use hostname only, no dots or domain names";
          } else {
            newErrors[name] = "Invalid value";
          }
        } else {
          newErrors[name] = "";
        }
      } catch (error) {
        console.warn(`Validation error for field ${name}:`, error);
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    }

    const newFormData = {
      ...formData,
      [name]: value,
    };
    setFormData(newFormData);
    onFormDataChange?.(newFormData);
  };

  const handleSelectChange = (name: string, value: string, options: Column['validator'], isOptional = false) => {
    const newErrors: Record<string, string> = {};

    // Validate - skip validation if field is optional and empty or if no validator is provided
    if (options && (value.trim() !== '' || !isOptional)) {
      const validatorFn = validator[options.name] as (value: string, options?: unknown) => boolean;
      if (!validatorFn(value, options.options)) {
        newErrors[name] = "Invalid value";
      } else {
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    }

    const newFormData = {
      ...formData,
      [name]: value,
    };
    setFormData(newFormData);
    onFormDataChange?.(newFormData);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>, options: Column['validator'], isOptional = false) => {
    const { name, value } = e.target;
    const newErrors: Record<string, string> = {};

    // For CSR, validate format if not empty (can include private key)
    if (name === 'custom_csr' && value.trim() !== '') {
      if (!value.includes('-----BEGIN CERTIFICATE REQUEST-----') || !value.includes('-----END CERTIFICATE REQUEST-----')) {
        newErrors[name] = "Must contain a valid PEM formatted certificate request";
      } else {
        newErrors[name] = "";
      }
    } else if (name === 'ise_cert_import_config' && value.trim() !== '') {
      // Validate JSON format
      try {
        JSON.parse(value);
        newErrors[name] = "";
      } catch (e) {
        newErrors[name] = "Must be valid JSON";
      }
    } else if (options && (value.trim() !== '' || !isOptional)) {
      const validatorFn = validator[options.name] as (value: string, options?: unknown) => boolean;
      if (!validatorFn(value, options.options)) {
        newErrors[name] = "Invalid value";
      } else {
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    }

    const newFormData = {
      ...formData,
      [name]: value,
    };
    setFormData(newFormData);
    onFormDataChange?.(newFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiCall(`/data`, {
        method: "POST",
        body: JSON.stringify(formData),
      });
      
      toast({
        title: "Success!",
        description: "Connection added successfully.",
        duration: 3000,
      });
      
      onDataAdded(); // Notify the table to refresh
      
      // Reset form with default values
      const resetData = data.reduce((obj: Record<string, string | boolean>, value) => {
        obj[value.name] = value.default || (value.type === "SWITCH" ? false : "");
        return obj;
      }, {});
      setFormData(resetData);
    } catch (error) {
      console.error("Error inserting data:", error);
      
      toast({
        title: "Error",
        description: "Failed to add connection. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    }
  };

  const formatColumnName = (col: string): string => {
    return col
      .replace(/[^a-zA-Z]+/g, " ") // Replace non-letter characters with spaces
      .split(' ')
      .map(word => {
        // Keep SSL, DNS, SSH, ISE, and URL in uppercase
        if (word.toLowerCase() === 'ssl' || word.toLowerCase() === 'dns' || word.toLowerCase() === 'ssh' || word.toLowerCase() === 'ise' || word.toLowerCase() === 'url') {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  };

  const handleCSRGenerated = (generatedData: { csr: string; privateKey: string; subject: string; commonName: string }) => {
    const applicationTypeValue = formData.application_type;
    
    // Update the appropriate fields based on application type
    let updates: Record<string, string> = {};
    
    if (applicationTypeValue === 'general') {
      updates = {
        custom_csr: generatedData.csr,
        general_private_key: generatedData.privateKey
      };
    } else if (applicationTypeValue === 'ise') {
      updates = {
        ise_certificate: generatedData.csr,
        ise_private_key: generatedData.privateKey
      };
    }
    
    const newFormData = {
      ...formData,
      ...updates
    };
    
    setFormData(newFormData);
    onFormDataChange?.(newFormData);
    
    toast({
      title: "CSR Generated",
      description: "Certificate Signing Request and private key have been generated and populated.",
      duration: 3000,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
      {data.map((col, index) => {
        try {
        const formValue = formData[col.name];
        const isOptional = col.optional === true;
        const label = col.label || formatColumnName(col.name);
        const placeholder = col.placeholder || (isOptional 
          ? `${label} (Optional)`
          : label);

        // Check if field should be shown based on conditional logic
        let shouldShow = true;
        
        if (col.conditional) {
          const fieldValue = formData[col.conditional.field];
          const conditionValue = col.conditional.value;
          
          // Handle boolean comparisons properly
          if (typeof conditionValue === 'boolean') {
            shouldShow = Boolean(fieldValue === true || Number(fieldValue) === 1 || fieldValue === "1") === conditionValue;
          } else {
            shouldShow = fieldValue === conditionValue;
          }
        } else if (col.conditionalMultiple) {
          shouldShow = col.conditionalMultiple.some(condition => 
            condition.values.includes(formData[condition.field])
          );
        } else if (col.conditionalNot) {
          const fieldValue = formData[col.conditionalNot.field];
          const conditionValue = col.conditionalNot.value;
          
          // Handle boolean comparisons properly
          if (typeof conditionValue === 'boolean') {
            shouldShow = Boolean(fieldValue === true || Number(fieldValue) === 1 || fieldValue === "1") !== conditionValue;
          } else {
            shouldShow = fieldValue !== conditionValue;
          }
        }
        
        // For conditional fields like custom_csr, make them required when their condition is met
        const isConditionallyRequired = col.conditional && shouldShow && col.name === 'custom_csr';
        
        // Skip validation for SWITCH types
        if (col.type === "SWITCH") {
          // Handle switch validation separately or skip it
        }
          
        if (!shouldShow) {
          return null;
        }

        return (
          <div key={col.name} className="space-y-2">
            {col.type !== "SWITCH" && (
              <div className="flex items-center justify-between">
                <Label>{label}</Label>
                {/* Generate CSR button for General and ISE applications - show next to label */}
                {col.type === "TEXTAREA" && (col.name === 'custom_csr' || col.name === 'ise_certificate') && 
                 (formData.application_type === 'general' || formData.application_type === 'ise') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsCSRWizardOpen(true)}
                  >
                    Generate CSR
                  </Button>
                )}
              </div>
            )}
            
            {col.type === "SELECT" ? (
              <Select 
                value={String(formValue || col.default || "")} 
                onValueChange={(value) => handleSelectChange(col.name, value, col.validator, isOptional)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={placeholder} />
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  {col.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : col.type === "INFO" ? (
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-md p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {col.description}
                </p>
              </div>
            ) : col.type === "SWITCH" ? (
              <div className="space-y-2">
                <div className="flex items-start space-x-3">
                  <Switch
                    id={col.name}
                    checked={Boolean(formValue)}
                    onCheckedChange={(checked) => {
                      const newFormData = { ...formData, [col.name]: checked };
                      setFormData(newFormData);
                      onFormDataChange?.(newFormData);
                      setErrors(prev => {
                        const newErrors = { ...prev };
                        delete newErrors[col.name];
                        return newErrors;
                      });
                    }}
                    className="mt-1"
                  />
                  <div className="space-y-1">
                    <Label htmlFor={col.name} className="text-sm font-medium cursor-pointer">
                      {label}
                    </Label>
                    {col.description && (
                      <p className="text-xs text-muted-foreground">
                        {col.description}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : col.type === "TEXTAREA" ? (
              <Textarea
                required={!isOptional || isConditionallyRequired}
                name={col.name}
                placeholder={placeholder}
                value={String(formValue || "")}
                rows={6}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                data-1p-ignore="true"
                className="resize-none"
                onChange={(e) => {
                  handleTextareaChange(e, col.validator, isOptional && !isConditionallyRequired);
                }}
              />
            ) : (
              <Input
                required={!isOptional || isConditionallyRequired}
                type={col.name === "password" || col.name === "pw" ? "password" : "text"}
                name={col.name}
                placeholder={placeholder}
                value={String(formValue || "")}
                autoComplete="off"
                data-lpignore="true"
                data-form-type="other"
                data-1p-ignore="true"
                autoFocus={index === 0}
                onChange={(e) => {
                  handleChange(e, col.validator, isOptional && !isConditionallyRequired);
                }}
              />
            )}
            
            {errors[col.name] && <span className="text-red-500 text-xs">{errors[col.name]}</span>}
          </div>
        );
        } catch (error) {
          console.error(`Error rendering field ${col.name}:`, error);
          return (
            <div key={col.name} className="space-y-2">
              <div className="text-red-500 text-sm">Error rendering field: {col.name}</div>
            </div>
          );
        }
      })}
      {!isPartOfTabbedForm && <Button type="submit">Add Connection</Button>}
      
      <CSRGeneratorWizard
        isOpen={isCSRWizardOpen}
        onClose={() => setIsCSRWizardOpen(false)}
        onGenerated={handleCSRGenerated}
        hostname={String(formData.hostname || "")}
        domain={String(formData.domain || "")}
      />
    </form>
  );
};

export default DataForm;