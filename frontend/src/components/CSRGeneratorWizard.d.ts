declare const CSRGeneratorWizard: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (generatedData: { csr: string; privateKey: string; subject: string; commonName: string; }) => void;
  hostname: string;
  domain: string;
}>;
export default CSRGeneratorWizard;