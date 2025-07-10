import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';

interface Column {
  name: string;
  type: string;
  optional?: boolean;
  label?: string;
  placeholder?: string;
  default?: string;
  options?: { value: string; label: string }[];
  allowCustom?: boolean;
  conditional?: {
    field: string;
    value: string;
  };
  validator: {
    name: keyof typeof validator;
    options?: any;
  };
}

interface EditConnectionModalProps {
  record: any;
  isOpen: boolean;
  onClose: () => void;
  onConnectionUpdated: () => void;
}

const EditConnectionModal: React.FC<EditConnectionModalProps> = ({ 
  record, 
  isOpen, 
  onClose, 
  onConnectionUpdated 
}) => {
  const { toast } = useToast();
  const [data, setData] = useState<Column[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      const response = await fetch("/dbSetup.json");
      const jsonData: Column[] = await response.json();
      setData(jsonData);
    };

    fetchData();
  }, []);

  useEffect(() => {
    if (record && data.length > 0) {
      // Initialize form data with record values
      const initialData = data.reduce((obj: Record<string, string>, col) => {
        obj[col.name] = record[col.name] || col.default || "";
        return obj;
      }, {});
      setFormData(initialData);
    }
  }, [record, data]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, options: Column['validator'], isOptional = false) => {
    const { name, value } = e.target;
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

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSelectChange = (name: string, value: string, options: Column['validator'], isOptional = false) => {
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

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
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

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      await apiCall(`/data/${record.id}`, {
        method: "PUT",
        body: JSON.stringify(formData),
      });
      
      toast({
        title: "Success!",
        description: "Connection updated successfully.",
        duration: 3000,
      });
      
      onConnectionUpdated(); // Notify the table to refresh
      onClose(); // Close the modal
    } catch (error) {
      console.error("Error updating connection:", error);
      
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
      .replace(/[^a-zA-Z]+/g, " ") // Replace non-letter characters with spaces
      .toUpperCase();
  };

  if (!record) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Connection</DialogTitle>
          <DialogDescription>
            Update the connection details for {record.name || 'this connection'}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4" autoComplete="off">
          {data.map((col, index) => {
            const formValue = formData[col.name];
            const isOptional = col.optional === true;
            const label = col.label || formatColumnName(col.name);
            const placeholder = col.placeholder || (isOptional 
              ? `${label} (Optional)`
              : label);

            // Check if field should be shown based on conditional logic
            const shouldShow = !col.conditional || formData[col.conditional.field] === col.conditional.value;
            
            // For conditional fields like custom_csr, make them required when their condition is met
            const isConditionallyRequired = col.conditional && formData[col.conditional.field] === col.conditional.value && col.name === 'custom_csr';
              
            if (!shouldShow) {
              return null;
            }
              
            return (
              <div key={col.name} className="space-y-2">
                <Label>{label}</Label>
                
                {col.type === "SELECT" ? (
                  <Select 
                    value={formValue || col.default || ""} 
                    onValueChange={(value) => handleSelectChange(col.name, value, col.validator, isOptional)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {col.options?.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : col.type === "TEXTAREA" ? (
                  <Textarea
                    required={!isOptional || isConditionallyRequired}
                    name={col.name}
                    placeholder={placeholder}
                    value={formValue || ""}
                    rows={6}
                    autoComplete="off"
                    data-lpignore="true"
                    data-form-type="other"
                    data-1p-ignore="true"
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
                    value={formValue || ""}
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
          })}
          
          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Updating...' : 'Update Connection'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditConnectionModal;