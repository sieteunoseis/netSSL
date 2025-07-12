import { PlatformProvider } from './platform-provider';
import { VOSProvider } from './vos-provider';
// Future imports for other platforms
// import { ISEProvider } from './ise-provider';

export type SupportedPlatform = 'vos' | 'ise' | 'general';

export class PlatformFactory {
  private static instances: Map<string, PlatformProvider> = new Map();

  static createProvider(platformType: SupportedPlatform): PlatformProvider {
    // Return cached instance if available
    if (this.instances.has(platformType)) {
      return this.instances.get(platformType)!;
    }

    let provider: PlatformProvider;

    switch (platformType) {
      case 'vos':
        provider = new VOSProvider();
        break;
      
      case 'ise':
        // Future implementation
        // provider = new ISEProvider();
        throw new Error('ISE platform provider not yet implemented');
      
      case 'general':
        // For general applications that don't need platform-specific APIs
        throw new Error('General platform provider not yet implemented');
      
      default:
        throw new Error(`Unsupported platform type: ${platformType}`);
    }

    // Cache the instance
    this.instances.set(platformType, provider);
    return provider;
  }

  static getSupportedPlatforms(): SupportedPlatform[] {
    return ['vos']; // Add 'ise', 'general' as they become available
  }

  static isPlatformSupported(platformType: string): boolean {
    return this.getSupportedPlatforms().includes(platformType as SupportedPlatform);
  }

  static clearCache(): void {
    this.instances.clear();
  }

  // Helper method to determine platform type from application_type
  static mapApplicationTypeToPlatform(applicationType: string): SupportedPlatform {
    switch (applicationType) {
      case 'vos':
        return 'vos';
      case 'ise':
        return 'ise';
      case 'general':
        return 'general';
      default:
        // Default to VOS for backward compatibility
        return 'vos';
    }
  }
}