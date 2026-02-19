import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { Terminal, Loader2 } from "lucide-react";
import { apiCall } from '../lib/api';
import { getConnectionDisplayHostname } from '../lib/connection-utils';
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
  validator: {
    name: keyof typeof validator;
    options?: any;
  };
}

interface EditConnectionModalTabbedProps {
  record: any;
  isOpen: boolean;
  onClose: () => void;
  onConnectionUpdated: () => void;
}

// Define the field groups
const FIELD_GROUPS = {
  basic: ["name", "application_type", "ise_application_subtype"],
  authentication: ["username", "password"],
  certificate: ["hostname", "domain", "ssl_provider", "dns_provider", "dns_challenge_mode", "alt_names", "custom_csr", "general_private_key", "ise_nodes", "ise_certificate", "ise_private_key", "ise_cert_import_config"],
  advanced: ["enable_ssh", "auto_restart_service", "ssh_cert_path", "ssh_key_path", "ssh_chain_path", "ssh_restart_command", "auto_renew", "is_enabled"]
};

const EditConnectionModalTabbed: React.FC<EditConnectionModalTabbedProps> = ({ 
  record, 
  isOpen, 
  onClose, 
  onConnectionUpdated 
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("basic");
  const [data, setData] = useState<Column[]>([]);
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCSRWizardOpen, setIsCSRWizardOpen] = useState(false);

  const handleCSRGenerated = (generatedData: { csr: string; privateKey: string; subject: string; commonName: string }) => {
    const applicationTypeValue = formData.application_type;
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

    setFormData(prev => ({ ...prev, ...updates }));
    toast({
      title: "CSR Generated",
      description: "Certificate Signing Request and private key have been generated and populated.",
      duration: 3000,
    });
  };

  // Fetch configuration data
  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json");
      const jsonData = await response.json();
      setData(jsonData);
    };
    fetchData();
  }, []);

  // Initialize form data when record changes
  useEffect(() => {
    console.log('EditModal: useEffect triggered', { recordExists: !!record, dataLength: data.length });
    if (record && data.length > 0) {
      console.log('EditModal: Starting form initialization');
      console.log('EditModal: Record passed to modal:', record);
      console.log('EditModal: Record application_type:', record.application_type);
      console.log('EditModal: Available data columns:', data.map(col => col.name));
      
      const processedFields = new Set();
      const initialData = data.reduce((obj: Record<string, string | boolean>, col) => {
        // Skip duplicate field names - only process the first occurrence
        if (processedFields.has(col.name)) {
          console.log(`EditModal: Skipping duplicate field ${col.name}`);
          return obj;
        }
        processedFields.add(col.name);
        
        let value = record[col.name];
        console.log(`EditModal: Processing field ${col.name}: record_value=${value}, default=${col.default}`);
        
        // Handle boolean conversion for SWITCH types
        if (col.type === "SWITCH" && value !== undefined) {
          value = Boolean(value === true || value === 1 || value === "1");
        }
        
        // For editing existing records, always use the record value if it exists
        // IMPORTANT: Check for empty string too, but not for critical fields like application_type
        if (value !== undefined && value !== null) {
          // For application_type, always use the record value even if it's an empty string
          if (col.name === 'application_type' || value !== '') {
            obj[col.name] = value;
            console.log(`EditModal: Used record value for ${col.name}: ${value}`);
          } else if (col.type === "SWITCH") {
            obj[col.name] = false;
          } else if (col.default !== undefined) {
            obj[col.name] = col.default;
            console.log(`EditModal: Used default for ${col.name}: ${col.default}`);
          } else {
            obj[col.name] = "";
          }
        } else if (col.type === "SWITCH") {
          obj[col.name] = false;
        } else if (col.default !== undefined) {
          obj[col.name] = col.default;
          console.log(`EditModal: Used default for ${col.name}: ${col.default}`);
        } else {
          obj[col.name] = "";
        }
        return obj;
      }, {});
      
      console.log('EditModal: Final form data:', initialData);
      console.log('EditModal: Final application_type:', initialData.application_type);
      
      setFormData(initialData);
      setActiveTab("basic");
      setErrors({});
    }
  }, [record, data]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, options: Column['validator'], isOptional = false) => {
    const { name, value } = e.target;
    const newErrors: Record<string, string> = {};

    // Validate - skip validation if field is optional and empty
    if (value.trim() !== '' || !isOptional) {
      try {
        const validatorFn = validator[options.name] as any;
        if (validatorFn && !validatorFn(value, options.options)) {
          newErrors[name] = "Invalid value";
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
      setErrors(prev => ({ ...prev, ...newErrors }));
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string, options: Column['validator'], isOptional = false) => {
    console.log(`SELECT CHANGE - ${name}: ${value}`);
    if (name === 'application_type') {
      console.log('APPLICATION_TYPE SELECT CHANGE:', value);
    }
    
    const newErrors: Record<string, string> = {};

    // Validate - skip validation if field is optional and empty
    if (value.trim() !== '' || !isOptional) {
      const validatorFn = validator[options.name] as any;
      if (!validatorFn(value, options.options)) {
        newErrors[name] = "Invalid value";
      } else {
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...newErrors }));
    }

    setFormData(prev => {
      const newData = { ...prev, [name]: value };
      if (name === 'application_type') {
        console.log('Setting application_type in formData:', value, 'New formData:', newData);
      }
      return newData;
    });
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
    } else if (value.trim() !== '' || !isOptional) {
      const validatorFn = validator[options.name] as any;
      if (!validatorFn(value, options.options)) {
        newErrors[name] = "Invalid value";
      } else {
        newErrors[name] = "";
      }
    } else {
      newErrors[name] = "";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(prev => ({ ...prev, ...newErrors }));
    }

    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setIsSubmitting(true);
      console.log('EditModal: Submitting form data:', formData);
      console.log('EditModal: ISE Application Subtype:', formData.ise_application_subtype);
      await apiCall(`/data/${record.id}`, {
        method: "PUT",
        body: JSON.stringify(formData),
      });
      
      toast({
        title: "Success!",
        description: "Connection updated successfully.",
        duration: 3000,
      });
      
      onConnectionUpdated();
      onClose();
    } catch (error) {
      console.error("Error updating data:", error);
      
      toast({
        title: "Error",
        description: "Failed to update connection. Please try again.",
        variant: "destructive",
        duration: 5000,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatColumnName = (col: string): string => {
    return col
      .replace(/[^a-zA-Z]+/g, " ")
      .split(' ')
      .map(word => {
        if (word.toLowerCase() === 'ssl' || word.toLowerCase() === 'dns' || word.toLowerCase() === 'ssh' || word.toLowerCase() === 'ise' || word.toLowerCase() === 'url') {
          return word.toUpperCase();
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');
  };

  // Check if a field should be visible based on all its conditions (AND logic)
  const isFieldVisible = (field: any) => {
    if (!field.conditional && !field.conditionalMultiple && !field.conditionalNot) return true;

    // All present conditions must pass (AND logic)
    if (field.conditional) {
      if (formData[field.conditional.field] !== field.conditional.value) return false;
    }
    if (field.conditionalMultiple) {
      const multiMatch = field.conditionalMultiple.some((condition: any) =>
        condition.values.includes(formData[condition.field])
      );
      if (!multiMatch) return false;
    }
    if (field.conditionalNot) {
      if (formData[field.conditionalNot.field] === field.conditionalNot.value) return false;
    }
    return true;
  };

  // Check if a tab should be shown based on conditional fields
  const shouldShowTab = (tabName: string) => {
    const fields = FIELD_GROUPS[tabName as keyof typeof FIELD_GROUPS];
    return fields.some(fieldName => {
      const field = data.find(f => f.name === fieldName);
      if (!field) return false;
      return isFieldVisible(field);
    });
  };

  // Get fields for a specific tab that should be shown
  const getTabFields = (tabName: string) => {
    const fieldNames = FIELD_GROUPS[tabName as keyof typeof FIELD_GROUPS];
    return data.filter(field => {
      if (!fieldNames.includes(field.name)) return false;
      return isFieldVisible(field);
    });
  };

  const renderField = (col: Column) => {
    const formValue = formData[col.name];
    if (col.name === 'application_type') {
      console.log(`RENDER DEBUG - ${col.name}: formValue=${formValue}, formData:`, formData);
    }
    const isOptional = col.optional === true;
    const label = col.label || formatColumnName(col.name);
    const placeholder = col.placeholder || (isOptional 
      ? `${label} (Optional)`
      : label);

    // For conditional fields like custom_csr, make them required when their condition is met
    const isConditionallyRequired = col.conditional && formData[col.conditional.field] === col.conditional.value && col.name === 'custom_csr';

    return (
      <div key={col.name} className="space-y-2">
        {col.type !== "SWITCH" && (
          <div className="flex items-center justify-between">
            <Label>{label}</Label>
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
          (() => {
            const selectValue = String(formValue !== undefined ? formValue : (col.default || ""));
            if (col.name === 'application_type') {
              console.log(`SELECT DEBUG - ${col.name}: formValue=${formValue}, selectValue=${selectValue}, options:`, col.options);
              console.log('Option values:', col.options?.map(opt => opt.value));
              console.log('Does selectValue match any option?', col.options?.some(opt => opt.value === selectValue));
              console.log('Matching option:', col.options?.find(opt => opt.value === selectValue));
            }
            return (
              <Select 
                key={`${col.name}-${selectValue}`}
                value={selectValue} 
                onValueChange={(value) => handleSelectChange(col.name, value, col.validator, isOptional)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={placeholder}>
                    {col.options?.find(opt => opt.value === selectValue)?.label || selectValue}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent position="item-aligned">
                  {col.options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })()
        ) : col.type === "SWITCH" ? (
          <div className="space-y-2">
            <div className="flex items-start space-x-3">
              <Switch
                id={col.name}
                checked={Boolean(formValue)}
                onCheckedChange={(checked) => {
                  setFormData(prev => ({ ...prev, [col.name]: checked }));
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
            onChange={(e) => {
              handleChange(e, col.validator, isOptional && !isConditionallyRequired);
            }}
          />
        )}
        
        {errors[col.name] && <span className="text-red-500 font-semibold">{errors[col.name]}</span>}
      </div>
    );
  };

  if (!record) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent tabIndex={-1} className="max-w-4xl w-[95vw] sm:w-[90vw] max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <DialogTitle>Edit Connection</DialogTitle>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium tracking-wide uppercase ${
              Boolean(formData.is_enabled)
                ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400'
                : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
            }`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                Boolean(formData.is_enabled)
                  ? 'bg-green-500 dark:bg-green-400'
                  : 'bg-red-500 dark:bg-red-400'
              }`} />
              {Boolean(formData.is_enabled) ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          <DialogDescription>
            Update the connection details for {record.name || 'this connection'}.
          </DialogDescription>
        </DialogHeader>
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            {shouldShowTab("authentication") && (
              <TabsTrigger value="authentication">Authentication</TabsTrigger>
            )}
            <TabsTrigger value="certificate">Certificate</TabsTrigger>
            {shouldShowTab("advanced") && (
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            )}
          </TabsList>
          
          <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto pl-1 pr-2 mt-4 pb-6 min-h-0 scroll-smooth scrollbar-styled max-h-[60vh]">
              <TabsContent value="basic" className="mt-0 space-y-4">
                {getTabFields("basic").map(renderField)}
              </TabsContent>
              
              {shouldShowTab("authentication") && (
                <TabsContent value="authentication" className="mt-0 space-y-4">
                  {getTabFields("authentication").map(renderField)}
                </TabsContent>
              )}
              
              <TabsContent value="certificate" className="mt-0 space-y-4">
                {getTabFields("certificate").map(renderField)}
              </TabsContent>
              
              {shouldShowTab("advanced") && (
                <TabsContent value="advanced" className="mt-0 space-y-4">
                  {getTabFields("advanced").map(renderField)}
                </TabsContent>
              )}
            </div>
            
            <div className="flex justify-end space-x-2 pt-4 border-t flex-shrink-0 bg-background">
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Updating...' : 'Update Connection'}
              </Button>
            </div>
          </form>
        </Tabs>
      </DialogContent>

      <CSRGeneratorWizard
        isOpen={isCSRWizardOpen}
        onClose={() => setIsCSRWizardOpen(false)}
        onGenerated={handleCSRGenerated}
        hostname={String(formData.hostname || "")}
        domain={String(formData.domain || "")}
      />
    </Dialog>
  );
};

export default EditConnectionModalTabbed;