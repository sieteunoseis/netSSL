declare const CSRGeneratorWizard: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (generatedData: any) => void;
  hostname: string;
  domain: string;
  mode?: 'generate' | 'configure';
}>;
export default CSRGeneratorWizard;