// Category enum for backward compat with legacy stencils
export enum StencilCategory {
  Networking = 0,
  Compute = 1,
  Database = 2,
  Storage = 3,
  Others = 4,
  Gallery = 5,
}

// Legacy stencil model (ads-stencils.json)
export interface StencilModel {
  key: string;
  name: string;
  iconPath: string;
  label: string;
  referenceArchPath?: string;
  category: StencilCategory;
}

// New Azure service model (azure-services.json / API)
export interface AzureServiceModel {
  key: string;
  name: string;
  category: string;
  iconPath: string;
}

export interface StencilPanelModel {
  key: string;
  iconPath: string;
  category: StencilCategory;
}

// Azure resource type keys
export const AdsConstants = {
  ResourceGroup: 'resource-group',
  StorageAccount: 'storage-account',
  VirtualNetwork: 'virtual-network',
  VirtualMachine: 'virtual-machine',
  Subnet: 'subnet',
  AzureFirewall: 'azure-firewall',
  Bastions: 'azure-bastions',
  PublicIp: 'public-ip',
  SqlServer: 'sql-server',
  SqlDatabase: 'sql-database',
  AppServicePlan: 'appservice-plan',
  FunctionApp: 'function-app',
  WebApp: 'web-app',
  AKSCluster: 'aks-cluster',
  APIM: 'apim',
  AppGateway: 'app-gateway',
} as const;

export type AdsConstantKey = (typeof AdsConstants)[keyof typeof AdsConstants];
