# Issues

Need to fix description

    Auto Restart Services
    VOS: Restart 'Cisco Tomcat' | ISE: Restart application services after certificate installation. ISE does not have an auto restart services function.

Manual DNS:

    ok i noticed on the "Edit Connection" modal under the "Certificate" tab there is a setting for DNS challenge mode with two options, Automated and Manual. I want to get rid of this. Logic should be as follows. If they have a DNS provider set that is anything other than Custom DNS (Manual) AND we have a corresponding API Key for the DNS providers under settings then we should use API. If the API key is missing or the API fails then we should show the manual DNS entry on the inline renewal component on the Home.jsx page. If they have Custom DNS (Manual) set we should always present the manual txt record to them and   wait 5 minutes to add the record. We should then use the CUSTOM_DNS_SERVER_1 and CUSTOM_DNS_SERVER_2 to validate them every 15 seconds, if CUSTOM_DNS_SERVER_1 or CUSTOM_DNS_SERVER_1 is not set use the "default"in dns-servers.json. Just because a user set their DNS to    manual and they also provided as an example a Cloudflare dns server: 1.1.1.1 we should never use the API on the manual dns entry. API will only be used in the above logic rule.