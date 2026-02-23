import { PlatformProvider } from './platform-provider';
import { VOSProvider } from './vos-provider';
import { ISEProvider } from './ise-provider';
import { GeneralProvider } from './general-provider';
import { CatalystCenterProvider } from './catalyst-center-provider';

export type SupportedPlatform = 'vos' | 'ise' | 'general' | 'catalyst_center';

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
        provider = new ISEProvider();
        break;
      
      case 'general':
        provider = new GeneralProvider();
        break;

      case 'catalyst_center':
        provider = new CatalystCenterProvider();
        break;

      default:
        throw new Error(`Unsupported platform type: ${platformType}`);
    }

    // Cache the instance
    this.instances.set(platformType, provider);
    return provider;
  }

  static getSupportedPlatforms(): SupportedPlatform[] {
    return ['vos', 'ise', 'general', 'catalyst_center'];
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
      case 'catalyst_center':
        return 'catalyst_center';
      default:
        // Default to VOS for backward compatibility
        return 'vos';
    }
  }
}