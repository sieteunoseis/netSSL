import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import validator from "validator";
import { apiCall } from '../lib/api';
import CSRGeneratorWizard from './CSRGeneratorWizard';
import ConnectionFieldRenderer from './ConnectionFieldRenderer';
import ISECertificateWizard from './ISECertificateWizard';
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

interface AddConnectionModalTabbedProps {
  onConnectionAdded: () => void;
  trigger?: React.ReactNode;
}

type TabName = 'basic' | 'authentication' | 'certificate' | 'advanced';

const AddConnectionModalTabbed: React.FC<AddConnectionModalTabbedProps> = ({
  onConnectionAdded,
  trigger
}) => {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  const [formData, setFormData] = useState<Record<string, string | boolean>>(() => getDefaultFormData('general'));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCSRWizardOpen, setIsCSRWizardOpen] = useState(false);

  // Reset form when modal opens
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      const appType = String(formData.application_type || 'general');
      setFormData(getDefaultFormData(appType));
      setActiveTab("basic");
      setErrors({});
    }
  };

  const handleCSRGenerated = (generatedData: any) => {
    const applicationTypeValue = formData.application_type;
    let updates: Record<string, string> = {};

    if (applicationTypeValue === 'general' || applicationTypeValue === 'catalyst_center') {
      updates = {
        custom_csr: generatedData.csr,
        general_private_key: generatedData.privateKey
      };
    } else if (applicationTypeValue === 'ise') {
      if (generatedData.mode === 'configure') {
        // ISE API mode — save config params
        updates = { ise_csr_config: generatedData.csrConfig };
      } else {
        // Fallback
        updates = { ise_certificate: generatedData.csr };
      }
    }

    setFormData(prev => ({ ...prev, ...updates }));
    toast({
      title: generatedData.mode === 'configure' ? "CSR Configuration Saved" : "CSR Generated",
      description: generatedData.mode === 'configure'
        ? "CSR subject details have been configured for ISE API generation."
        : "Certificate Signing Request and private key have been generated and populated.",
      duration: 3000,
    });
  };

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
      await apiCall('/data', {
        method: "POST",
        body: JSON.stringify(formData),
      });

      toast({
        title: "Success!",
        description: "Connection added successfully.",
        duration: 3000,
      });

      onConnectionAdded();
      setIsOpen(false);

      // Reset form
      setFormData(getDefaultFormData('general'));
      setErrors({});
    } catch (error) {
      console.error("Error inserting data:", error);

      const errorMessage = error instanceof Error ? error.message : "Failed to add connection";
      const errorDetails = (error as any)?.details || "";

      toast({
        title: "Error",
        description: errorDetails || errorMessage,
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

  const defaultTrigger = (
    <Button className="flex items-center space-x-2">
      <Plus className="w-4 h-4" />
      <span>Add Connection</span>
    </Button>
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-[90vw] max-h-[90vh] h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add New Connection</DialogTitle>
          <DialogDescription>
            Add a new Cisco application connection for certificate management.
          </DialogDescription>
        </DialogHeader>

        <Tabs key="modal-tabs" value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 flex-shrink-0">
            <TabsTrigger value="basic">Basic Info</TabsTrigger>
            {hasVisibleFields(profile.tabs.authentication, formData) && (
              <TabsTrigger value="authentication">Authentication</TabsTrigger>
            )}
            <TabsTrigger value="certificate">Certificate</TabsTrigger>
            {hasVisibleFields(profile.tabs.advanced, formData) && (
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            )}
          </TabsList>

          <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto pl-1 pr-2 mt-4 pb-4 min-h-0 scroll-smooth scrollbar-styled">
              <TabsContent value="basic" tabIndex={-1} className="mt-0 space-y-4">
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
                <TabsContent value="authentication" tabIndex={-1} className="mt-0 space-y-4">
                  {getVisibleFields('authentication').map(renderField)}
                </TabsContent>
              )}

              <TabsContent value="certificate" tabIndex={-1} className="mt-0 space-y-4">
                {appType === 'ise' ? (
                  <ISECertificateWizard
                    formData={formData}
                    errors={errors}
                    renderField={renderField}
                    onFieldChange={(name, value) => setFormData(prev => ({ ...prev, [name]: value }))}
                    onCsrGenerateClick={() => setIsCSRWizardOpen(true)}
                  />
                ) : (
                  getVisibleFields('certificate').map(renderField)
                )}
              </TabsContent>

              {hasVisibleFields(profile.tabs.advanced, formData) && (
                <TabsContent value="advanced" tabIndex={-1} className="mt-0 space-y-4">
                  {getVisibleFields('advanced').map(renderField)}
                </TabsContent>
              )}
            </div>

            <div className="flex justify-end pt-4 border-t flex-shrink-0 bg-background">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Adding...' : 'Add Connection'}
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
        mode={formData.application_type === 'ise' ? 'configure' : 'generate'}
      />
    </Dialog>
  );
};

export default AddConnectionModalTabbed;
