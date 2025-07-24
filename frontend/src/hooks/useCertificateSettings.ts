import { useState, useEffect } from 'react';
import { apiCall } from '@/lib/api';

interface CertificateSettings {
  renewalDays: number;
  warningDays: number;
  checkSchedule: string;
}

export const useCertificateSettings = () => {
  const [settings, setSettings] = useState<CertificateSettings>({
    renewalDays: 7,
    warningDays: 30,
    checkSchedule: '0 0 * * *'
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await apiCall('/settings/renewal');
        const data = await response.json();
        
        const renewalSettings: CertificateSettings = {
          renewalDays: 7,
          warningDays: 30,
          checkSchedule: '0 0 * * *'
        };

        data.forEach((setting: { key_name: string; key_value: string }) => {
          if (setting.key_name === 'CERT_RENEWAL_DAYS') {
            renewalSettings.renewalDays = parseInt(setting.key_value) || 7;
          } else if (setting.key_name === 'CERT_WARNING_DAYS') {
            renewalSettings.warningDays = parseInt(setting.key_value) || 30;
          } else if (setting.key_name === 'CERT_CHECK_SCHEDULE') {
            renewalSettings.checkSchedule = setting.key_value || '0 0 * * *';
          }
        });

        setSettings(renewalSettings);
      } catch (error) {
        console.error('Failed to fetch certificate settings:', error);
        // Use defaults on error
      }
    };

    fetchSettings();
  }, []);

  return settings;
};