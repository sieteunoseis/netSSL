import React, { useState, useEffect, useRef } from 'react';
import { apiCall } from "@/lib/api";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronLeft, ChevronRight, Key, FileText, CheckCircle, AlertCircle } from "lucide-react";

const CSRGeneratorWizard = ({ isOpen, onClose, onGenerated, hostname, domain }) => {
  const dialogContentRef = useRef(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    country: '',
    state: '',
    locality: '',
    organization: '',
    organizationalUnit: '',
    keySize: '2048'
  });
  const [generatedData, setGeneratedData] = useState(null);

  useEffect(() => {
    if (isOpen && dialogContentRef.current) {
      requestAnimationFrame(() => {
        const firstInput = dialogContentRef.current.querySelector(
          'input[name]:not([disabled]), [role="radio"]:not([disabled])'
        );
        if (firstInput) {
          firstInput.focus();
        }
      });
    }
  }, [isOpen, currentStep]);

  const steps = [
    {
      title: 'Basic Information',
      description: 'Enter your organization details',
      fields: [
        {
          key: 'country',
          label: 'Country Code',
          placeholder: 'US',
          description: '2-letter country code (e.g., US, CA, GB)',
          required: true
        }
      ]
    },
    {
      title: 'Location Details',
      description: 'Specify your location information',
      fields: [
        {
          key: 'state',
          label: 'State/Province',
          placeholder: 'Oregon',
          description: 'Full state or province name',
          required: true
        },
        {
          key: 'locality',
          label: 'City/Locality',
          placeholder: 'Portland',
          description: 'City or locality name',
          required: true
        }
      ]
    },
    {
      title: 'Organization (Optional)',
      description: 'Add organization details if needed',
      fields: [
        {
          key: 'organization',
          label: 'Organization',
          placeholder: 'Your Company Name',
          description: 'Organization or company name',
          required: false
        },
        {
          key: 'organizationalUnit',
          label: 'Organizational Unit',
          placeholder: 'IT Department',
          description: 'Department or unit name',
          required: false
        }
      ]
    },
    {
      title: 'Key Size',
      description: 'Select the RSA key size for your certificate',
      fields: [
        {
          key: 'keySize',
          label: 'RSA Key Size',
          type: 'radio',
          description: '2048-bit is recommended for most use cases. 4096-bit provides higher security but slower performance.',
          required: true,
          options: [
            { value: '2048', label: '2048-bit (Recommended)', description: 'Standard security, faster performance' },
            { value: '4096', label: '4096-bit (High Security)', description: 'Enhanced security, slower performance' }
          ]
        }
      ]
    }
  ];

  const validateStep = (stepIndex) => {
    const step = steps[stepIndex];
    const requiredFields = step.fields.filter(field => field.required);
    
    return requiredFields.every(field => {
      const value = formData[field.key];
      if (field.key === 'country') {
        return value && value.length === 2 && /^[A-Z]{2}$/.test(value.toUpperCase());
      }
      if (field.key === 'keySize') {
        return value && ['2048', '4096'].includes(value);
      }
      return value && value.trim().length > 0;
    });
  };

  const handleInputChange = (key, value) => {
    setFormData(prev => ({
      ...prev,
      [key]: key === 'country' ? value.toUpperCase() : value
    }));
    setError('');
  };

  const handleKeyDown = (e, field) => {
    if (e.key === 'Tab' && !formData[field.key] && field.placeholder) {
      e.preventDefault();
      handleInputChange(field.key, field.placeholder);
      // Focus next input after a short delay
      setTimeout(() => {
        const inputs = document.querySelectorAll('input');
        const currentIndex = Array.from(inputs).findIndex(input => input.name === field.key);
        if (currentIndex !== -1 && currentIndex < inputs.length - 1) {
          inputs[currentIndex + 1].focus();
        }
      }, 0);
    }
  };

  // Add keyboard event handler for the dialog
  const handleDialogKeyDown = (e) => {
    const activeElement = document.activeElement;
    
    // Handle spacebar and enter on Next/Generate button
    if ((e.key === 'Enter' || e.key === ' ') && activeElement?.hasAttribute('data-next-button')) {
      e.preventDefault();
      handleNext();
      return;
    }
    
    // Handle Enter on form fields to advance to next step
    if (e.key === 'Enter' && activeElement && (activeElement.tagName === 'INPUT' || activeElement.getAttribute('role') === 'radio')) {
      if (validateStep(currentStep)) {
        e.preventDefault();
        handleNext();
      }
    }
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) {
      setError('Please fill in all required fields correctly.');
      return;
    }
    
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleGenerate();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const generateCSRBackend = async (csrRequest) => {
    try {
      // Use the apiCall helper to ensure proper backend communication
      const response = await apiCall('/generate-csr', {
        method: 'POST',
        body: JSON.stringify(csrRequest)
      });

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to generate CSR');
      }
      
      return result.data;
    } catch (err) {
      // Add more detailed error information
      console.error('CSR generation error:', err);
      throw new Error('Failed to generate CSR: ' + err.message);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError('');

    try {
      // Build common name
      const commonName = hostname && domain ? `${hostname}.${domain}` : (domain || 'example.com');
      
      // Prepare CSR request for backend
      const csrRequest = {
        commonName,
        country: formData.country,
        state: formData.state,
        locality: formData.locality,
        organization: formData.organization || undefined,
        organizationalUnit: formData.organizationalUnit || undefined,
        keySize: parseInt(formData.keySize)
      };

      // Generate CSR using backend API
      const result = await generateCSRBackend(csrRequest);

      setGeneratedData({
        csr: result.csr,
        privateKey: result.privateKey,
        subject: result.subject,
        commonName
      });
      setCurrentStep(steps.length); // Move to success step
    } catch (err) {
      setError('Failed to generate CSR and private key: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUseGenerated = () => {
    if (generatedData) {
      onGenerated(generatedData);
      onClose();
    }
  };

  const handleClose = () => {
    setCurrentStep(0);
    setFormData({
      country: '',
      state: '',
      locality: '',
      organization: '',
      organizationalUnit: '',
      keySize: '2048'
    });
    setGeneratedData(null);
    setError('');
    onClose();
  };

  const isLastStep = currentStep === steps.length - 1;
  const isSuccessStep = currentStep === steps.length;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent ref={dialogContentRef} className="max-w-2xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div onKeyDown={handleDialogKeyDown}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              CSR Generator Wizard
            </DialogTitle>
            <DialogDescription>
              Generate a Certificate Signing Request (CSR) and private key for your certificate
            </DialogDescription>
          </DialogHeader>

        {!isSuccessStep && (
          <>
            {/* Progress indicator */}
            <div className="flex items-center justify-between mb-6">
              {steps.map((step, index) => (
                <div key={index} className="flex items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                    index === currentStep 
                      ? 'bg-blue-600 text-white' 
                      : index < currentStep 
                        ? 'bg-green-600 text-white' 
                        : 'bg-gray-200 text-gray-600'
                  }`}>
                    {index < currentStep ? <CheckCircle className="h-4 w-4" /> : index + 1}
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`w-16 h-1 mx-2 ${
                      index < currentStep ? 'bg-green-600' : 'bg-gray-200'
                    }`} />
                  )}
                </div>
              ))}
            </div>

            {/* Current step content */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{steps[currentStep].title}</CardTitle>
                <CardDescription>{steps[currentStep].description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {steps[currentStep].fields.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <Label htmlFor={field.key}>
                      {field.label}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </Label>
                    
                    {field.type === 'radio' ? (
                      <RadioGroup
                        value={formData[field.key]}
                        onValueChange={(value) => handleInputChange(field.key, value)}
                        className="space-y-3"
                      >
                        {field.options.map((option) => (
                          <div key={option.value} className="flex items-start space-x-3">
                            <RadioGroupItem value={option.value} id={`${field.key}-${option.value}`} className="mt-1" />
                            <div className="space-y-1">
                              <Label 
                                htmlFor={`${field.key}-${option.value}`} 
                                className="text-sm font-medium cursor-pointer"
                              >
                                {option.label}
                              </Label>
                              <p className="text-xs text-muted-foreground">{option.description}</p>
                            </div>
                          </div>
                        ))}
                      </RadioGroup>
                    ) : (
                      <Input
                        id={field.key}
                        name={field.key}
                        placeholder={field.placeholder}
                        value={formData[field.key]}
                        onChange={(e) => handleInputChange(field.key, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, field)}
                        maxLength={field.key === 'country' ? 2 : undefined}
                      />
                    )}
                    
                    {field.type !== 'radio' && (
                      <p className="text-sm text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                ))}

                {/* Common Name preview */}
                {currentStep === 0 && (hostname || domain) && (
                  <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Common Name will be:</strong> {hostname && domain ? `${hostname}.${domain}` : domain || 'Not specified'}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* Success step */}
        {isSuccessStep && generatedData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                CSR Generated Successfully
              </CardTitle>
              <CardDescription>
                Your Certificate Signing Request and private key have been generated
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <strong>Common Name:</strong>
                  <div className="font-mono text-xs mt-1">{generatedData.commonName}</div>
                </div>
                <div>
                  <strong>Subject:</strong>
                  <div className="font-mono text-xs mt-1">{generatedData.subject}</div>
                </div>
              </div>
              
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Success!</strong> Your Certificate Signing Request and private key have been generated 
                  using industry-standard cryptographic libraries. The CSR is ready to be submitted to your 
                  Certificate Authority.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Navigation buttons */}
        <div className="flex justify-between pt-4">
          <Button 
            variant="outline" 
            onClick={isSuccessStep ? handleClose : handleBack}
            disabled={loading || (!isSuccessStep && currentStep === 0)}
            tabIndex={-1}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            {isSuccessStep ? 'Close' : 'Back'}
          </Button>

          {!isSuccessStep && (
            <Button 
              onClick={handleNext}
              disabled={loading || !validateStep(currentStep)}
              data-next-button="true"
            >
              {loading ? (
                'Generating...'
              ) : isLastStep ? (
                <>
                  <Key className="h-4 w-4 mr-2" />
                  Generate CSR
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          )}

          {isSuccessStep && (
            <Button onClick={handleUseGenerated}>
              Use Generated CSR & Key
            </Button>
          )}
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CSRGeneratorWizard;