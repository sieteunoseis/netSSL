declare module '../dns-servers.json' {
  interface DNSServers {
    [provider: string]: string[];
  }
  
  const dnsServers: DNSServers;
  export default dnsServers;
}