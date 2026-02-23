import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';
import CSRGeneratorWizard from './CSRGeneratorWizard';
import ConnectionFieldRenderer from './ConnectionFieldRenderer';
import {
  type FieldDefinition,
  applicationTypeField,
} from '@/lib/connection-fields';
import {
  getProfile,
  getDefaultFormData,
  isFieldVisible,
  hasVisibleFields,
} from '@/lib/type-profiles';

interface EditConnectionModalTabbedProps {
  record: any;
  isOpen: boolean;
  onClose: () => void;
  onConnectionUpdated: () => void;
}

type TabName = 'basic' | 'authentication' | 'certificate' | 'advanced';

const EditConnectionModalTabbed: React.FC<EditConnectionModalTabbedProps> = ({
  record,
  isOpen,
  onClose,
  onConnectionUpdated
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("basic");
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

  // Initialize form data when record changes
  useEffect(() => {
    if (!record) return;

    // Build defaults from the record's application type
    const appType = record.application_type || 'general';
    const defaults = getDefaultFormData(appType);
    const initialData: Record<string, string | boolean> = {};

    // Merge defaults with record values
    for (const [key, defaultVal] of Object.entries(defaults)) {
      let value = record[key];

      // Handle boolean conversion for switch fields
      if (typeof defaultVal === 'boolean' && value !== undefined) {
        value = Boolean(value === true || value === 1 || value === '1');
      }

      // Prefer record value over default
      if (value !== undefined && value !== null) {
        if (key === 'application_type' || value !== '') {
          initialData[key] = value;
        } else if (typeof defaultVal === 'boolean') {
          initialData[key] = false;
        } else if (defaultVal !== undefined) {
          initialData[key] = defaultVal;
        } else {
          initialData[key] = '';
        }
      } else if (typeof defaultVal === 'boolean') {
        initialData[key] = defaultVal;
      } else if (defaultVal !== undefined) {
        initialData[key] = defaultVal;
      } else {
        initialData[key] = '';
      }
    }

    // Also include any record fields not covered by the profile defaults
    // (e.g., dns_challenge_mode or other fields stored in the database)
    for (const [key, value] of Object.entries(record)) {
      if (initialData[key] === undefined && value !== undefined && value !== null) {
        initialData[key] = value as string | boolean;
      }
    }

    setFormData(initialData);
    setActiveTab("basic");
    setErrors({});
  }, [record]);

  // ---------------------------------------------------------------------------
  // Validation handlers
  // ---------------------------------------------------------------------------

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, field: FieldDefinition) => {
    const { name, value } = e.target;
    const isOptional = field.optional === true;
    const newErrors: Record<string, string> = {};

    if (field.validation && (value.trim() !== '' || !isOptional)) {
      try {
        const validatorFn = validator[field.validation.name as keyof typeof validator] as any;
        if (validatorFn && !validatorFn(value, field.validation.options)) {
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

    setErrors(prev => ({ ...prev, ...newErrors }));
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string, field: FieldDefinition) => {
    const isOptional = field.optional === true;
    const newErrors: Record<string, string> = {};

    if (field.validation && (value.trim() !== '' || !isOptional)) {
      try {
        const validatorFn = validator[field.validation.name as keyof typeof validator] as any;
        if (validatorFn && !validatorFn(value, field.validation.options)) {
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

    setErrors(prev => ({ ...prev, ...newErrors }));
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>, field: FieldDefinition) => {
    const { name, value } = e.target;
    const isOptional = field.optional === true;
    const newErrors: Record<string, string> = {};

    if (name === 'custom_csr' && value.trim() !== '') {
      if (!value.includes('-----BEGIN CERTIFICATE REQUEST-----') || !value.includes('-----END CERTIFICATE REQUEST-----')) {
        newErrors[name] = "Must contain a valid PEM formatted certificate request";
      } else {
        newErrors[name] = "";
      }
    } else if (name === 'ise_cert_import_config' && value.trim() !== '') {
      try {
        JSON.parse(value);
        newErrors[name] = "";
      } catch {
        newErrors[name] = "Must be valid JSON";
      }
    } else if (field.validation && (value.trim() !== '' || !isOptional)) {
      try {
        const validatorFn = validator[field.validation.name as keyof typeof validator] as any;
        if (validatorFn && !validatorFn(value, field.validation.options)) {
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

    setErrors(prev => ({ ...prev, ...newErrors }));
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSwitchChange = (name: string, checked: boolean) => {
    setFormData(prev => ({ ...prev, [name]: checked }));
    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[name];
      return newErrors;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setIsSubmitting(true);
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

  // ---------------------------------------------------------------------------
  // Profile-based rendering
  // ---------------------------------------------------------------------------

  const appType = String(formData.application_type || 'general');
  const profile = getProfile(appType);

  const getVisibleFields = (tabName: TabName): FieldDefinition[] => {
    return profile.tabs[tabName].filter(f => isFieldVisible(f, formData));
  };

  const renderField = (field: FieldDefinition) => {
    return (
      <ConnectionFieldRenderer
        key={field.name}
        field={field}
        value={formData[field.name]}
        error={errors[field.name]}
        applicationType={appType}
        onChange={handleSwitchChange}
        onSelectChange={(name, value) => handleSelectChange(name, value, field)}
        onTextareaChange={(e) => handleTextareaChange(e, field)}
        onInputChange={(e) => handleChange(e, field)}
        onCsrGenerateClick={() => setIsCSRWizardOpen(true)}
      />
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
            {hasVisibleFields(profile.tabs.authentication, formData) && (
              <TabsTrigger value="authentication">Authentication</TabsTrigger>
            )}
            <TabsTrigger value="certificate">Certificate</TabsTrigger>
            {hasVisibleFields(profile.tabs.advanced, formData) && (
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            )}
          </TabsList>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
            <div className="flex-1 overflow-y-auto pl-1 pr-2 mt-4 pb-6 min-h-0 scroll-smooth scrollbar-styled max-h-[60vh]">
              <TabsContent value="basic" className="mt-0 space-y-4">
                {/* Application type selector — always first */}
                <ConnectionFieldRenderer
                  field={applicationTypeField}
                  value={formData.application_type}
                  error={errors.application_type}
                  onChange={handleSwitchChange}
                  onSelectChange={(name, value) => handleSelectChange(name, value, applicationTypeField)}
                />
                {getVisibleFields('basic').map(renderField)}
              </TabsContent>

              {hasVisibleFields(profile.tabs.authentication, formData) && (
                <TabsContent value="authentication" className="mt-0 space-y-4">
                  {getVisibleFields('authentication').map(renderField)}
                </TabsContent>
              )}

              <TabsContent value="certificate" className="mt-0 space-y-4">
                {getVisibleFields('certificate').map(renderField)}
              </TabsContent>

              {hasVisibleFields(profile.tabs.advanced, formData) && (
                <TabsContent value="advanced" className="mt-0 space-y-4">
                  {getVisibleFields('advanced').map(renderField)}
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
